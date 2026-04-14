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
import type { TodoStatus, TodoPriority } from 'libs/db/src/mongo/model/todo.model';

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
  }): Observable<any>;
  GetTodo(data: { todo_id: string }): Observable<any>;
  ListTodos(data: {
    userId: string;
    roomId?: string;
    page: number;
    limit: number;
    status?: string;
  }): Observable<any>;
  UpdateTodo(data: {
    todo_id: string;
    todo_title?: string;
    todo_description?: string;
    todo_status?: string;
    todo_priority?: string;
    todo_dueDate?: string;
  }): Observable<any>;
  DeleteTodo(data: { todo_id: string }): Observable<any>;
  AssignTodo(data: { todo_id: string; assignee_ids: string[] }): Observable<any>;
  UpdateTodoStatus(data: { todo_id: string; status: string }): Observable<any>;
}

@Controller('ai/todo')
export class GatewayTodoController {
  private todoService: TodoGrpcService;

  constructor(
    @Inject(SERVICES.LEARNING) private readonly learningClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {
    this.todoService = this.learningClient.getService<TodoGrpcService>('TodoService');
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
    @Body() body: { assignee_ids: string[] },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.todoService.AssignTodo.bind(this.todoService),
      { todo_id, assignee_ids: body.assignee_ids },
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
}
