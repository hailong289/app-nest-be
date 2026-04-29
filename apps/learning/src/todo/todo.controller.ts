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
import { TodoProjectService } from './todo-project.service';
import {
  AddProjectMemberDto,
  AddProjectStatusDto,
  CreateTodoProjectDto,
  DeleteProjectStatusDto,
  DeleteTodoProjectDto,
  GetProjectMembersDto,
  GetOrCreateDefaultProjectDto,
  GetTodoProjectDto,
  ListTodoProjectsDto,
  RemoveProjectMemberDto,
  UpdateProjectStatusDto,
  UpdateTodoProjectDto,
} from './dto/todo-project.dto';

@Controller()
export class TodoController {
  constructor(
    private readonly todoService: TodoService,
    private readonly todoProjectService: TodoProjectService,
  ) {}

  // ─── Todo handlers ────────────────────────────────────────────────────────────

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
  async updateTodo(data: UpdateTodoDto & { todo_id: string; todo_projectId?: string }) {
    return await this.todoService.updateTodo(data.todo_id, data);
  }

  @GrpcMethod('TodoService', 'DeleteTodo')
  async deleteTodo(data: DeleteTodoDto) {
    return await this.todoService.deleteTodo(data.todo_id);
  }

  @GrpcMethod('TodoService', 'AssignTodo')
  async assignTodo(data: AssignTodoDto) {
    return await this.todoService.assignTodo(
      data.todo_id,
      data.assignee_ids ?? [],
    );
  }

  @GrpcMethod('TodoService', 'UpdateTodoStatus')
  async updateTodoStatus(data: UpdateTodoStatusDto) {
    return await this.todoService.updateTodoStatus(data.todo_id, data.status);
  }

  // ─── Project handlers ─────────────────────────────────────────────────────────

  @GrpcMethod('TodoService', 'CreateProject')
  async createProject(data: CreateTodoProjectDto) {
    return await this.todoProjectService.createProject(data);
  }

  @GrpcMethod('TodoService', 'GetProject')
  async getProject(data: GetTodoProjectDto) {
    return await this.todoProjectService.getProjectById(data.project_id, data.userId);
  }

  @GrpcMethod('TodoService', 'ListProjects')
  async listProjects(data: ListTodoProjectsDto) {
    return await this.todoProjectService.listProjects(data);
  }

  @GrpcMethod('TodoService', 'UpdateProject')
  async updateProject(data: UpdateTodoProjectDto) {
    return await this.todoProjectService.updateProject(data);
  }

  @GrpcMethod('TodoService', 'DeleteProject')
  async deleteProject(data: DeleteTodoProjectDto) {
    return await this.todoProjectService.deleteProject(data);
  }

  @GrpcMethod('TodoService', 'AddProjectStatus')
  async addProjectStatus(data: AddProjectStatusDto) {
    return await this.todoProjectService.addProjectStatus(data);
  }

  @GrpcMethod('TodoService', 'UpdateProjectStatus')
  async updateProjectStatus(data: UpdateProjectStatusDto) {
    return await this.todoProjectService.updateProjectStatus(data);
  }

  @GrpcMethod('TodoService', 'DeleteProjectStatus')
  async deleteProjectStatus(data: DeleteProjectStatusDto) {
    return await this.todoProjectService.deleteProjectStatus(data);
  }

  @GrpcMethod('TodoService', 'GetOrCreateDefaultProject')
  async getOrCreateDefaultProject(data: GetOrCreateDefaultProjectDto) {
    return await this.todoProjectService.getOrCreateDefaultProject(data);
  }

  @GrpcMethod('TodoService', 'AddProjectMember')
  async addProjectMember(data: AddProjectMemberDto) {
    return await this.todoProjectService.addProjectMember(data);
  }

  @GrpcMethod('TodoService', 'RemoveProjectMember')
  async removeProjectMember(data: RemoveProjectMemberDto) {
    return await this.todoProjectService.removeProjectMember(data);
  }

  @GrpcMethod('TodoService', 'GetProjectMembers')
  async getProjectMembers(data: GetProjectMembersDto) {
    return await this.todoProjectService.getProjectMembers(data);
  }
}
