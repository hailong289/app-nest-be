import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  AddProjectStatusDto,
  CreateTodoProjectDto,
  DeleteProjectStatusDto,
  DeleteTodoProjectDto,
  GetOrCreateDefaultProjectDto,
  GetTodoProjectDto,
  ListTodoProjectsDto,
  UpdateProjectStatusDto,
  UpdateTodoProjectDto,
} from './dto/todo-project.dto';
import { TodoProjectService } from './todo-project.service';

@Controller()
export class TodoProjectController {
  constructor(private readonly todoProjectService: TodoProjectService) {}

  @GrpcMethod('TodoService', 'CreateProject')
  async createProject(data: CreateTodoProjectDto) {
    return await this.todoProjectService.createProject(data);
  }

  @GrpcMethod('TodoService', 'GetProject')
  async getProject(data: GetTodoProjectDto) {
    return await this.todoProjectService.getProjectById(data.project_id);
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
}
