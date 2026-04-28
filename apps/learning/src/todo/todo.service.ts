import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Todo } from 'libs/db/src/mongo/model/todo.model';
import { Model, Types } from 'mongoose';
import {
  AssignTodoDto,
  CreateTodoDto,
  ListTodosDto,
  UpdateTodoDto,
  UpdateTodoStatusDto,
} from './dto/todo.dto';
import { Response } from 'libs/helpers/response';

@Injectable()
export class TodoService {
  constructor(
    @InjectModel(Todo.name) private readonly todoModel: Model<Todo>,
  ) {}

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
      createdAt: todo.createdAt ? new Date(todo.createdAt).toISOString() : '',
      updatedAt: todo.updatedAt ? new Date(todo.updatedAt).toISOString() : '',
    };
  }

  async createTodo(data: CreateTodoDto) {
    try {
      const todoData: Record<string, any> = {
        todo_title: data.todo_title,
        todo_description: data.todo_description ?? '',
        todo_status: data.todo_status ?? 'todo',
        todo_priority: data.todo_priority ?? 'medium',
        todo_createdBy: new Types.ObjectId(data.todo_createdBy),
        todo_assignees: (data.todo_assignees ?? []).map(
          (id) => new Types.ObjectId(id),
        ),
      };

      if (data.todo_dueDate) {
        todoData.todo_dueDate = new Date(data.todo_dueDate);
      }

      if (data.todo_roomId && Types.ObjectId.isValid(data.todo_roomId)) {
        todoData.todo_roomId = new Types.ObjectId(data.todo_roomId);
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
    const { userId, roomId, page, limit, status } = data;

    const filter: Record<string, any> = {};

    if (roomId && Types.ObjectId.isValid(roomId)) {
      // Lấy todo theo phòng
      filter.todo_roomId = new Types.ObjectId(roomId);
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

  async assignTodo(todo_id: string, assignee_ids: string[]) {
    try {
      const assignees = assignee_ids
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

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
