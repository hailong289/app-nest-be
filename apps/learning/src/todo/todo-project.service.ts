import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ProjectStatus,
  TodoProject,
} from 'libs/db/src/mongo/model/todo-project.model';
import { Model, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';
import { Response } from 'libs/helpers/response';
import {
  AddProjectStatusDto,
  AddProjectMemberDto,
  CreateTodoProjectDto,
  DeleteProjectStatusDto,
  DeleteTodoProjectDto,
  GetProjectMembersDto,
  GetOrCreateDefaultProjectDto,
  ListTodoProjectsDto,
  RemoveProjectMemberDto,
  UpdateProjectStatusDto,
  UpdateTodoProjectDto,
} from './dto/todo-project.dto';
import { GatewayClientService } from '../gateway-client.service';

@Injectable()
export class TodoProjectService {
  constructor(
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

  private async resolveRoom(roomId: string | undefined, userId: string) {
    if (!roomId) return null;
    const room = await this.gatewayClient.resolveRoomForUser(roomId, userId);
    if (!room?.mongoRoomId) {
      throw new Error('Room not found');
    }
    return room;
  }

  private toMetadata(project: Record<string, any>) {
    return {
      _id: project._id?.toString() ?? '',
      project_id: project.project_id ?? '',
      project_name: project.project_name ?? '',
      project_description: project.project_description ?? '',
      project_color: project.project_color ?? '#3B82F6',
      project_createdBy: project.project_createdBy?.toString() ?? '',
      project_roomId: project.project_roomId?.toString() ?? '',
      is_default: !!project.is_default,
      project_statuses: (project.project_statuses ?? []).map((status: any) => ({
        status_id: status.status_id,
        status_name: status.status_name,
        status_color: status.status_color ?? '#6B7280',
        status_order: Number(status.status_order) || 1,
      })),
      project_members: (project.project_members ?? []).map((member: any) =>
        member?.toString(),
      ),
      createdAt: project.createdAt
        ? new Date(project.createdAt).toISOString()
        : '',
      updatedAt: project.updatedAt
        ? new Date(project.updatedAt).toISOString()
        : '',
    };
  }

  private getDefaultProjectPayload(userId: string, mongoRoomId?: string) {
    return {
      project_name: 'Default',
      project_description: 'Default project',
      project_color: '#3B82F6',
      project_createdBy: new Types.ObjectId(userId),
      project_roomId:
        mongoRoomId && Types.ObjectId.isValid(mongoRoomId)
          ? new Types.ObjectId(mongoRoomId)
          : null,
      is_default: true,
      project_members: [new Types.ObjectId(userId)],
    };
  }

  async createProject(data: CreateTodoProjectDto) {
    try {
      await this.validateUser(data.project_createdBy, 'project_createdBy');
      const room = await this.resolveRoom(
        data.project_roomId,
        data.project_createdBy,
      );
      const project = await this.todoProjectModel.create({
        project_name: data.project_name,
        project_description: data.project_description ?? '',
        project_color: data.project_color ?? '#3B82F6',
        project_createdBy: new Types.ObjectId(data.project_createdBy),
        project_roomId:
          room?.mongoRoomId && Types.ObjectId.isValid(room.mongoRoomId)
            ? new Types.ObjectId(room.mongoRoomId)
            : null,
        is_default: data.is_default ?? false,
        project_members: [new Types.ObjectId(data.project_createdBy)],
      });
      return Response.success(this.toMetadata(project.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getProjectById(project_id: string, userId?: string) {
    const filter: Record<string, any> =
      Types.ObjectId.isValid(project_id) && project_id.length === 24
        ? { $or: [{ project_id }, { _id: new Types.ObjectId(project_id) }] }
        : { project_id };
    if (userId && Types.ObjectId.isValid(userId)) {
      const userObjectId = new Types.ObjectId(userId);
      filter.$or = [
        { project_createdBy: userObjectId },
        { project_members: userObjectId },
      ];
    }

    const project = await this.todoProjectModel.findOne(filter).lean();
    if (!project) {
      return Response.error('Project not found', 404, 'NOT_FOUND');
    }
    return Response.success(this.toMetadata(project));
  }

  async listProjects(data: ListTodoProjectsDto) {
    const { userId, roomId, page, limit } = data;
    const userObjectId = new Types.ObjectId(userId);
    const filter: Record<string, any> = {
      $or: [
        { project_createdBy: userObjectId },
        { project_members: userObjectId },
      ],
    };

    if (roomId) {
      const room = await this.resolveRoom(roomId, userId);
      if (!room) {
        return Response.error('Room not found', 404, 'NOT_FOUND');
      }
      filter.project_roomId = new Types.ObjectId(room.mongoRoomId);
    } else {
      filter.project_roomId = null;
    }

    const [projects, total] = await Promise.all([
      this.todoProjectModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      this.todoProjectModel.countDocuments(filter),
    ]);

    return Response.success({
      data: projects.map((project) => this.toMetadata(project)),
      total_item: total,
      total_page: Math.ceil(total / limit),
      page,
    });
  }

  async updateProject(data: UpdateTodoProjectDto) {
    try {
      const updateData: Record<string, any> = {};
      if (data.project_name !== undefined)
        updateData.project_name = data.project_name;
      if (data.project_description !== undefined)
        updateData.project_description = data.project_description;
      if (data.project_color !== undefined)
        updateData.project_color = data.project_color;

      const project = await this.todoProjectModel
        .findOneAndUpdate({ project_id: data.project_id }, updateData, {
          new: true,
        })
        .lean();

      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(project));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteProject(data: DeleteTodoProjectDto) {
    const project = await this.todoProjectModel.findOneAndDelete({
      project_id: data.project_id,
    });
    if (!project) {
      return Response.error('Project not found', 404, 'NOT_FOUND');
    }
    return Response.success('Project deleted successfully');
  }

  async addProjectStatus(data: AddProjectStatusDto) {
    try {
      const project = await this.todoProjectModel.findOne({
        project_id: data.project_id,
      });
      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }

      const normalizedName = data.status_name.trim();
      const duplicated = project.project_statuses.some(
        (item) =>
          item.status_name.toLowerCase() === normalizedName.toLowerCase(),
      );
      if (duplicated) {
        return Response.error('Status already exists', 400, 'BAD_REQUEST');
      }

      project.project_statuses.push({
        status_id: Utils.randomId(),
        status_name: normalizedName,
        status_color: data.status_color ?? '#6B7280',
        status_order: project.project_statuses.length + 1,
      } as ProjectStatus);

      await project.save();
      return Response.success(this.toMetadata(project.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async updateProjectStatus(data: UpdateProjectStatusDto) {
    try {
      const project = await this.todoProjectModel.findOne({
        project_id: data.project_id,
      });
      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }

      const idx = project.project_statuses.findIndex(
        (item) => item.status_id === data.status_id,
      );
      if (idx < 0) {
        return Response.error('Status not found', 404, 'NOT_FOUND');
      }

      if (data.status_name !== undefined) {
        project.project_statuses[idx].status_name = data.status_name.trim();
      }
      if (data.status_color !== undefined) {
        project.project_statuses[idx].status_color = data.status_color;
      }
      if (data.status_order !== undefined) {
        project.project_statuses[idx].status_order = data.status_order;
        project.project_statuses = project.project_statuses
          .sort((a, b) => a.status_order - b.status_order)
          .map((item, orderIndex) => ({
            ...item,
            status_order: orderIndex + 1,
          }));
      }

      await project.save();
      return Response.success(this.toMetadata(project.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteProjectStatus(data: DeleteProjectStatusDto) {
    try {
      const project = await this.todoProjectModel.findOne({
        project_id: data.project_id,
      });
      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }

      if (project.project_statuses.length <= 1) {
        return Response.error(
          'Project must have at least one status',
          400,
          'BAD_REQUEST',
        );
      }

      const existing = project.project_statuses.find(
        (status) => status.status_id === data.status_id,
      );
      if (!existing) {
        return Response.error('Status not found', 404, 'NOT_FOUND');
      }

      project.project_statuses = project.project_statuses
        .filter((status) => status.status_id !== data.status_id)
        .map((status, index) => ({ ...status, status_order: index + 1 }));

      await project.save();
      return Response.success(this.toMetadata(project.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getOrCreateDefaultProject(data: GetOrCreateDefaultProjectDto) {
    try {
      await this.validateUser(data.userId);
      const room = await this.resolveRoom(data.roomId, data.userId);
      const roomObjectId =
        room?.mongoRoomId && Types.ObjectId.isValid(room.mongoRoomId)
          ? new Types.ObjectId(room.mongoRoomId)
          : null;

      let project = await this.todoProjectModel.findOne({
        project_createdBy: new Types.ObjectId(data.userId),
        project_roomId: roomObjectId,
        is_default: true,
      });

      if (!project) {
        project = await this.todoProjectModel.create(
          this.getDefaultProjectPayload(data.userId, room?.mongoRoomId),
        );
      }

      return Response.success(this.toMetadata(project.toObject()));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async addProjectMember(data: AddProjectMemberDto) {
    try {
      if (!Types.ObjectId.isValid(data.member_id)) {
        return Response.error('Invalid member id', 400, 'BAD_REQUEST');
      }
      await this.validateUser(data.member_id, 'member_id');
      // project_id là business id (string). Hỗ trợ thêm trường hợp FE gửi Mongo _id
      // bằng cách check ObjectId hợp lệ và match theo _id.
      const projectFilter: Record<string, any> = Types.ObjectId.isValid(
        data.project_id,
      )
        ? {
            $or: [
              { project_id: data.project_id },
              { _id: new Types.ObjectId(data.project_id) },
            ],
          }
        : { project_id: data.project_id };
      const existingProject = await this.todoProjectModel
        .findOne(projectFilter)
        .lean();

      if (!existingProject) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }
      if (existingProject.project_roomId) {
        const access = await this.gatewayClient.checkRoomAccess(
          existingProject.project_roomId.toString(),
          data.member_id,
        );
        if (!access?.canView) {
          return Response.error(
            'Member không thuộc phòng của project',
            403,
            'FORBIDDEN',
          );
        }
      }

      const project = await this.todoProjectModel
        .findOneAndUpdate(
          projectFilter,
          {
            $addToSet: { project_members: new Types.ObjectId(data.member_id) },
          },
          { new: true },
        )
        .lean();

      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(project));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async removeProjectMember(data: RemoveProjectMemberDto) {
    try {
      if (!Types.ObjectId.isValid(data.member_id)) {
        return Response.error('Invalid member id', 400, 'BAD_REQUEST');
      }
      const project = await this.todoProjectModel.findOne({
        project_id: data.project_id,
      });
      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }

      if (project.project_createdBy?.toString() === data.member_id) {
        return Response.error(
          'Cannot remove project creator',
          400,
          'BAD_REQUEST',
        );
      }

      await this.todoProjectModel.updateOne(
        { project_id: data.project_id },
        { $pull: { project_members: new Types.ObjectId(data.member_id) } },
      );
      const updated = await this.todoProjectModel
        .findOne({ project_id: data.project_id })
        .lean();
      if (!updated) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }
      return Response.success(this.toMetadata(updated));
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getProjectMembers(data: GetProjectMembersDto) {
    try {
      const project = await this.todoProjectModel
        .findOne({ project_id: data.project_id })
        .lean();
      if (!project) {
        return Response.error('Project not found', 404, 'NOT_FOUND');
      }

      const memberIds = (project.project_members ?? []).map((m: any) =>
        m?.toString(),
      );
      const creatorId = project.project_createdBy?.toString() ?? '';

      const users = await this.gatewayClient.getUsersSummary(
        memberIds,
        data.search,
      );

      const members = users.map((u: any) => ({
        _id: u._id || u.userId || '',
        usr_id: u.usr_id ?? '',
        fullname: u.fullname || u.name || '',
        email: u.email ?? '',
        phone: u.phone ?? '',
        avatar: u.avatar ?? '',
        is_creator: (u._id || u.userId) === creatorId,
      }));

      return Response.success({
        project_id: project.project_id,
        member_ids: memberIds,
        members,
      });
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }
}
