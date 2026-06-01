import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Todo } from 'libs/db/src/mongo/model/todo.model';
import { TodoProject } from 'libs/db/src/mongo/model/todo-project.model';
import { Model, Types } from 'mongoose';
import {
  AssignTodoDto,
  CreateTodoDto,
  ListTodosDto,
  UpdateTodoDto,
  UpdateTodoStatusDto,
} from './dto/todo.dto';
import { Response } from 'libs/helpers/response';
import { GatewayClientService } from '../gateway-client.service';

@Injectable()
export class TodoService {
  constructor(
    @InjectModel(Todo.name) private readonly todoModel: Model<Todo>,
    @InjectModel(TodoProject.name)
    private readonly todoProjectModel: Model<TodoProject>,
    private readonly gatewayClient: GatewayClientService,
  ) {}

  private assertObjectId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`${label} phải là Mongo ObjectId`);
    }
  }

  private async validateUser(userId: string, label = 'userId') {
    this.assertObjectId(userId, label);
    const user = await this.gatewayClient.getUserSummary(userId);
    if (!user) {
      throw new Error(`${label} không tồn tại`);
    }
    return user;
  }

  private async validateUsers(userIds: string[], label = 'userIds') {
    const uniqueIds = Array.from(new Set(userIds || []));
    uniqueIds.forEach((id) => this.assertObjectId(id, label));
    if (uniqueIds.length === 0) return [];

    const users = await this.gatewayClient.getUsersSummary(uniqueIds);
    const foundIds = new Set(users.map((user) => user._id || user.userId));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new Error(`${label} không tồn tại: ${missing.join(', ')}`);
    }
    return users;
  }

  private async resolveRoom(roomId: string | undefined, userId: string) {
    if (!roomId) return null;
    const room = await this.gatewayClient.resolveRoomForUser(roomId, userId);
    if (!room?.mongoRoomId) {
      throw new Error('Room not found');
    }
    return room;
  }

  private async getOrCreateDefaultProject(userId: string, roomId?: string) {
    const roomObjectId =
      roomId && Types.ObjectId.isValid(roomId)
        ? new Types.ObjectId(roomId)
        : null;
    const userObjectId = new Types.ObjectId(userId);

    let project = await this.todoProjectModel.findOne({
      project_createdBy: userObjectId,
      project_roomId: roomObjectId,
      is_default: true,
    });

    if (!project) {
      project = await this.todoProjectModel.create({
        project_name: 'Default',
        project_description: 'Default project',
        project_color: '#3B82F6',
        project_createdBy: userObjectId,
        project_roomId: roomObjectId,
        is_default: true,
      });
    }

    return project;
  }

  private async ensureProjectAndStatus(
    projectId: string | undefined,
    status: string,
    createdBy: string,
    roomId?: string,
  ): Promise<Record<string, any>> {
    let project: Record<string, any>;
    if (projectId) {
      const existingProject = await this.todoProjectModel
        .findOne({ project_id: projectId })
        .lean();
      project = existingProject as Record<string, any>;
      if (!project) {
        throw new Error('Project not found');
      }
    } else {
      project = (
        await this.getOrCreateDefaultProject(createdBy, roomId)
      ).toObject() as Record<string, any>;
    }

    const allowedStatuses = new Set<string>();
    (project.project_statuses ?? []).forEach((item: any) => {
      const statusName = String(item.status_name ?? '').toLowerCase();
      const statusId = String(item.status_id ?? '').toLowerCase();
      if (statusName) allowedStatuses.add(statusName);
      if (statusId) allowedStatuses.add(statusId);
    });

    if (
      allowedStatuses.size > 0 &&
      !allowedStatuses.has(status.toLowerCase())
    ) {
      throw new Error('Status is not allowed in this project');
    }

    return project;
  }

  private toMetadata(todo: Record<string, any>) {
    return {
      todo_id: todo.todo_id ?? '',
      todo_title: todo.todo_title ?? '',
      todo_description: todo.todo_description ?? '',
      todo_status: todo.todo_status ?? 'todo',
      todo_priority: todo.todo_priority ?? 'medium',
      todo_dueDate: todo.todo_dueDate
        ? new Date(todo.todo_dueDate).toISOString()
        : '',
      todo_roomId: todo.todo_roomId?.toString() ?? '',
      todo_createdBy: todo.todo_createdBy?.toString() ?? '',
      todo_assignees: (todo.todo_assignees ?? []).map((a: any) =>
        a?.toString(),
      ),
      todo_projectId: todo.todo_projectId ?? '',
      createdAt: todo.createdAt ? new Date(todo.createdAt).toISOString() : '',
      updatedAt: todo.updatedAt ? new Date(todo.updatedAt).toISOString() : '',
    };
  }

  async createTodo(data: CreateTodoDto) {
    try {
      await this.validateUser(data.todo_createdBy, 'todo_createdBy');
      await this.validateUsers(data.todo_assignees ?? [], 'todo_assignees');
      const room = await this.resolveRoom(
        data.todo_roomId,
        data.todo_createdBy,
      );
      for (const assigneeId of data.todo_assignees ?? []) {
        if (room?.mongoRoomId) {
          const access = await this.gatewayClient.checkRoomAccess(
            room.mongoRoomId,
            assigneeId,
          );
          if (!access?.canView) {
            return Response.error(
              'Assignee không thuộc phòng của todo',
              403,
              'FORBIDDEN',
            );
          }
        }
      }

      let desiredStatus = data.todo_status;
      if (!desiredStatus) {
        const project = data.todo_projectId
          ? await this.todoProjectModel
              .findOne({ project_id: data.todo_projectId })
              .lean()
          : (
              await this.getOrCreateDefaultProject(
                data.todo_createdBy,
                room?.mongoRoomId,
              )
            ).toObject();
        desiredStatus =
          project?.project_statuses?.[0]?.status_name ??
          project?.project_statuses?.[0]?.status_id ??
          'todo';
      }
      const project = await this.ensureProjectAndStatus(
        data.todo_projectId,
        desiredStatus,
        data.todo_createdBy,
        room?.mongoRoomId,
      );

      const todoData: Record<string, any> = {
        todo_title: data.todo_title,
        todo_description: data.todo_description ?? '',
        todo_status: desiredStatus,
        todo_priority: data.todo_priority ?? 'medium',
        todo_createdBy: new Types.ObjectId(data.todo_createdBy),
        todo_assignees: (data.todo_assignees ?? []).map(
          (id) => new Types.ObjectId(id),
        ),
        todo_projectId: project.project_id,
      };

      if (data.todo_dueDate) {
        todoData.todo_dueDate = new Date(data.todo_dueDate);
      }

      if (room?.mongoRoomId && Types.ObjectId.isValid(room.mongoRoomId)) {
        todoData.todo_roomId = new Types.ObjectId(room.mongoRoomId);
      }

      const todo = await this.todoModel.create(todoData);
      return Response.success(this.toMetadata(todo.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getTodoById(todo_id: string) {
    const todo = await this.todoModel.findOne({ todo_id }).lean();
    if (!todo) {
      return Response.error('Todo not found', 404, 'NOT_FOUND');
    }
    return Response.success(this.toMetadata(todo));
  }

  async listTodos(data: ListTodosDto) {
    const { userId, roomId, page, limit, status, projectId } = data;

    const filter: Record<string, any> = {};

    if (projectId) {
      // Khi đã lọc theo project thì không cần filter theo assignee/creator.
      filter.todo_projectId = projectId;
      if (roomId) {
        const room = await this.resolveRoom(roomId, userId);
        if (!room) {
          return Response.error('Room not found', 404, 'NOT_FOUND');
        }
        filter.todo_roomId = new Types.ObjectId(room.mongoRoomId);
      } else {
        filter.todo_roomId = null;
      }
    } else if (roomId) {
      // Lấy todo theo phòng
      const room = await this.resolveRoom(roomId, userId);
      if (!room) {
        return Response.error('Room not found', 404, 'NOT_FOUND');
      }
      filter.todo_roomId = new Types.ObjectId(room.mongoRoomId);
    } else {
      // Lấy todo cá nhân: do user tạo hoặc được assign, và không thuộc phòng
      filter.todo_roomId = null;
      filter.$or = [
        { todo_createdBy: new Types.ObjectId(userId) },
        { todo_assignees: new Types.ObjectId(userId) },
      ];
    }

    if (status) {
      filter.todo_status = status;
    }

    const [todos, total] = await Promise.all([
      this.todoModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      this.todoModel.countDocuments(filter),
    ]);

    return Response.success({
      data: todos.map((t) => this.toMetadata(t)),
      total_item: total,
      total_page: Math.ceil(total / limit),
      page,
    });
  }

  async updateTodo(todo_id: string, data: UpdateTodoDto) {
    try {
      const updateData: Record<string, any> = {};

      if (data.todo_title !== undefined)
        updateData.todo_title = data.todo_title;
      if (data.todo_description !== undefined)
        updateData.todo_description = data.todo_description;
      if (data.todo_status !== undefined)
        updateData.todo_status = data.todo_status;
      if (data.todo_priority !== undefined)
        updateData.todo_priority = data.todo_priority;
      if (data.todo_dueDate !== undefined)
        updateData.todo_dueDate = data.todo_dueDate
          ? new Date(data.todo_dueDate)
          : null;
      if (data.todo_projectId !== undefined)
        updateData.todo_projectId = data.todo_projectId;

      if (data.todo_status !== undefined || data.todo_projectId !== undefined) {
        const existingTodo = await this.todoModel.findOne({ todo_id }).lean();
        if (!existingTodo) {
          return Response.error('Todo not found', 404, 'NOT_FOUND');
        }
        const nextProjectId =
          data.todo_projectId ?? existingTodo.todo_projectId ?? undefined;
        const nextStatus =
          data.todo_status ?? existingTodo.todo_status ?? 'todo';
        await this.ensureProjectAndStatus(
          nextProjectId,
          nextStatus,
          existingTodo.todo_createdBy.toString(),
          existingTodo.todo_roomId?.toString(),
        );
      }

      const todo = await this.todoModel
        .findOneAndUpdate({ todo_id }, updateData, { new: true })
        .lean();

      if (!todo) {
        return Response.error('Todo not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(todo));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteTodo(todo_id: string) {
    const todo = await this.todoModel.findOneAndDelete({ todo_id });
    if (!todo) {
      return Response.error('Todo not found', 404, 'NOT_FOUND');
    }
    return Response.success('Todo deleted successfully');
  }

  async assignTodo(todo_id: string, assignee_ids: string[] = []) {
    try {
      await this.validateUsers(assignee_ids, 'assignee_ids');
      const assignees = assignee_ids.map((id) => new Types.ObjectId(id));
      const existingTodo = await this.todoModel.findOne({ todo_id }).lean();
      if (!existingTodo) {
        return Response.error('Todo not found', 404, 'NOT_FOUND');
      }
      if (existingTodo.todo_roomId) {
        for (const assignee of assignees) {
          const access = await this.gatewayClient.checkRoomAccess(
            existingTodo.todo_roomId.toString(),
            assignee.toString(),
          );
          if (!access?.canView) {
            return Response.error(
              'Assignee không thuộc phòng của todo',
              403,
              'FORBIDDEN',
            );
          }
        }
      }

      const todo = await this.todoModel
        .findOneAndUpdate(
          { todo_id },
          { $set: { todo_assignees: assignees } },
          { new: true },
        )
        .lean();

      if (!todo) {
        return Response.error('Todo not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(todo));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async updateTodoStatus(
    todo_id: string,
    status: UpdateTodoStatusDto['status'],
  ) {
    try {
      const existingTodo = await this.todoModel.findOne({ todo_id }).lean();
      if (!existingTodo) {
        return Response.error('Todo not found', 404, 'NOT_FOUND');
      }
      await this.ensureProjectAndStatus(
        existingTodo.todo_projectId ?? undefined,
        status,
        existingTodo.todo_createdBy.toString(),
        existingTodo.todo_roomId?.toString(),
      );

      const todo = await this.todoModel
        .findOneAndUpdate(
          { todo_id },
          { $set: { todo_status: status } },
          { new: true },
        )
        .lean();

      if (!todo) {
        return Response.error('Todo not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(todo));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }
}
