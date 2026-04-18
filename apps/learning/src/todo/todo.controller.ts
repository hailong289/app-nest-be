import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { TodoService } from './todo.service';
import {
  AssignTodoDto,
  CreateTodoDto,
  DeleteTodoDto,
  GetTodoDto,
  ListTodosDto,
  UpdateTodoDto,
  UpdateTodoStatusDto,
} from './dto/todo.dto';

@Controller()
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @GrpcMethod('TodoService', 'CreateTodo')
  async createTodo(data: CreateTodoDto) {
    return await this.todoService.createTodo(data);
  }

  @GrpcMethod('TodoService', 'GetTodo')
  async getTodo(data: GetTodoDto) {
    return await this.todoService.getTodoById(data.todo_id);
  }

  @GrpcMethod('TodoService', 'ListTodos')
  async listTodos(data: ListTodosDto) {
    return await this.todoService.listTodos(data);
  }

  @GrpcMethod('TodoService', 'UpdateTodo')
  async updateTodo(data: UpdateTodoDto & { todo_id: string }) {
    return await this.todoService.updateTodo(data.todo_id, data);
  }

  @GrpcMethod('TodoService', 'DeleteTodo')
  async deleteTodo(data: DeleteTodoDto) {
    return await this.todoService.deleteTodo(data.todo_id);
  }

  @GrpcMethod('TodoService', 'AssignTodo')
  async assignTodo(data: AssignTodoDto) {
    return await this.todoService.assignTodo(data.todo_id, data.assignee_ids);
  }

  @GrpcMethod('TodoService', 'UpdateTodoStatus')
  async updateTodoStatus(data: UpdateTodoStatusDto) {
    return await this.todoService.updateTodoStatus(data.todo_id, data.status);
  }
}
