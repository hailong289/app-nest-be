import { SERVICES } from '@app/constants';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { GatewayService } from '../../gateway/gateway.service';
import type { AuthenticatedRequest } from 'libs/types/auth.type';
import type {
  TodoStatus,
  TodoPriority,
} from 'libs/db/src/mongo/model/todo.model';

interface TodoGrpcService {
  CreateTodo(data: {
    todo_title: string;
    todo_description?: string;
    todo_status?: string;
    todo_priority?: string;
    todo_dueDate?: string;
    todo_roomId?: string;
    todo_createdBy: string;
    todo_assignees?: string[];
    todo_projectId?: string;
  }): Observable<any>;
  GetTodo(data: { todo_id: string }): Observable<any>;
  ListTodos(data: {
    userId: string;
    roomId?: string;
    page: number;
    limit: number;
    status?: string;
    projectId?: string;
  }): Observable<any>;
  UpdateTodo(data: {
    todo_id: string;
    todo_title?: string;
    todo_description?: string;
    todo_status?: string;
    todo_priority?: string;
    todo_dueDate?: string;
    todo_projectId?: string;
  }): Observable<any>;
  DeleteTodo(data: { todo_id: string }): Observable<any>;
  AssignTodo(data: {
    todo_id: string;
    assignee_ids: string[];
  }): Observable<any>;
  UpdateTodoStatus(data: { todo_id: string; status: string }): Observable<any>;
  CreateProject(data: {
    project_name: string;
    project_description?: string;
    project_color?: string;
    project_createdBy: string;
    project_roomId?: string;
    is_default?: boolean;
  }): Observable<any>;
  GetProject(data: { project_id: string; userId?: string }): Observable<any>;
  ListProjects(data: {
    userId: string;
    roomId?: string;
    page: number;
    limit: number;
  }): Observable<any>;
  UpdateProject(data: {
    project_id: string;
    project_name?: string;
    project_description?: string;
    project_color?: string;
  }): Observable<any>;
  DeleteProject(data: { project_id: string }): Observable<any>;
  AddProjectStatus(data: {
    project_id: string;
    status_name: string;
    status_color?: string;
  }): Observable<any>;
  UpdateProjectStatus(data: {
    project_id: string;
    status_id: string;
    status_name?: string;
    status_color?: string;
    status_order?: number;
  }): Observable<any>;
  DeleteProjectStatus(data: {
    project_id: string;
    status_id: string;
  }): Observable<any>;
  AddProjectMember(data: {
    project_id: string;
    member_id: string;
  }): Observable<any>;
  RemoveProjectMember(data: {
    project_id: string;
    member_id: string;
  }): Observable<any>;
  GetProjectMembers(data: {
    project_id: string;
    search?: string;
  }): Observable<any>;
}

@Controller('learning/todo')
export class GatewayTodoController {
  private todoService: TodoGrpcService;

  constructor(
    @Inject(SERVICES.LEARNING) private readonly learningClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {
    this.todoService =
      this.learningClient.getService<TodoGrpcService>('TodoService');
  }

  @Post('create')
  async createTodo(
    @Body()
    body: {
      todo_title: string;
      todo_description?: string;
      todo_status?: TodoStatus;
      todo_priority?: TodoPriority;
      todo_dueDate?: string;
      todo_roomId?: string;
      todo_assignees?: string[];
      todo_projectId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.CreateTodo.bind(this.todoService),
      { ...body, todo_createdBy: req.user._id },
    );
  }

  @Get('get/:todo_id')
  async getTodo(@Param('todo_id') todo_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.GetTodo.bind(this.todoService),
      { todo_id },
    );
  }

  @Get('list')
  async listTodos(
    @Query('roomId') roomId: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('status') status: string,
    @Query('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.ListTodos.bind(this.todoService),
      {
        userId: req.user._id,
        roomId,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
        status,
        projectId,
      },
    );
  }

  @Patch('update/:todo_id')
  async updateTodo(
    @Param('todo_id') todo_id: string,
    @Body()
    body: {
      todo_title?: string;
      todo_description?: string;
      todo_status?: TodoStatus;
      todo_priority?: TodoPriority;
      todo_dueDate?: string;
      todo_projectId?: string;
    },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.UpdateTodo.bind(this.todoService),
      { todo_id, ...body },
    );
  }

  @Delete('delete/:todo_id')
  async deleteTodo(@Param('todo_id') todo_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.DeleteTodo.bind(this.todoService),
      { todo_id },
    );
  }

  @Patch(':todo_id/assign')
  async assignTodo(
    @Param('todo_id') todo_id: string,
    @Body() body: { assignee_ids?: string[] },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.AssignTodo.bind(this.todoService),
      { todo_id, assignee_ids: body.assignee_ids ?? [] },
    );
  }

  @Patch(':todo_id/status')
  async updateTodoStatus(
    @Param('todo_id') todo_id: string,
    @Body() body: { status: TodoStatus },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.UpdateTodoStatus.bind(this.todoService),
      { todo_id, status: body.status },
    );
  }

  @Post('project/create')
  async createProject(
    @Body()
    body: {
      project_name: string;
      project_description?: string;
      project_color?: string;
      project_roomId?: string;
      is_default?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.CreateProject.bind(this.todoService),
      { ...body, project_createdBy: req.user._id },
    );
  }

  @Get('project/list')
  async listProjects(
    @Query('roomId') roomId: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.ListProjects.bind(this.todoService),
      {
        userId: req.user._id,
        roomId,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
      },
    );
  }

  @Get('project/:project_id')
  async getProject(
    @Param('project_id') project_id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.GetProject.bind(this.todoService),
      { project_id, userId: req.user._id },
    );
  }

  @Patch('project/:project_id')
  async updateProject(
    @Param('project_id') project_id: string,
    @Body()
    body: {
      project_name?: string;
      project_description?: string;
      project_color?: string;
    },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.UpdateProject.bind(this.todoService),
      { project_id, ...body },
    );
  }

  @Delete('project/:project_id')
  async deleteProject(@Param('project_id') project_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.DeleteProject.bind(this.todoService),
      { project_id },
    );
  }

  @Post('project/:project_id/status')
  async addProjectStatus(
    @Param('project_id') project_id: string,
    @Body() body: { status_name: string; status_color?: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.AddProjectStatus.bind(this.todoService),
      { project_id, ...body },
    );
  }

  @Patch('project/:project_id/status/:status_id')
  async updateProjectStatus(
    @Param('project_id') project_id: string,
    @Param('status_id') status_id: string,
    @Body() body: { status_name?: string; status_color?: string; status_order?: number },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.UpdateProjectStatus.bind(this.todoService),
      { project_id, status_id, ...body },
    );
  }

  @Delete('project/:project_id/status/:status_id')
  async deleteProjectStatus(
    @Param('project_id') project_id: string,
    @Param('status_id') status_id: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.DeleteProjectStatus.bind(this.todoService),
      { project_id, status_id },
    );
  }

  @Post('project/:project_id/members')
  async addProjectMember(
    @Param('project_id') project_id: string,
    @Body() body: { member_id: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.AddProjectMember.bind(this.todoService),
      { project_id, member_id: body.member_id },
    );
  }

  @Post('project/:project_id/join')
  async joinProject(
    @Param('project_id') project_id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.AddProjectMember.bind(this.todoService),
      { project_id, member_id: req.user._id },
    );
  }

  @Delete('project/:project_id/leave')
  async leaveProject(
    @Param('project_id') project_id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.RemoveProjectMember.bind(this.todoService),
      { project_id, member_id: req.user._id },
    );
  }

  @Delete('project/:project_id/members/:member_id')
  async removeProjectMember(
    @Param('project_id') project_id: string,
    @Param('member_id') member_id: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.RemoveProjectMember.bind(this.todoService),
      { project_id, member_id },
    );
  }

  @Get('project/:project_id/members')
  async getProjectMembers(
    @Param('project_id') project_id: string,
    @Query('search') search?: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.GetProjectMembers.bind(this.todoService),
      { project_id, search: search || '' },
    );
  }
}
