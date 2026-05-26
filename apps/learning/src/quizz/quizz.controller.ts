import { Controller } from '@nestjs/common';
import { QuizzService } from './quizz.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  CreateQuizzDto,
  DeleteQuizzDto,
  GetQuizzDto,
  ListQuizzesDto,
  SubmitQuizzDto,
  UpdateQuizzDto,
} from './dto/quizz.dto';

@Controller()
export class QuizzController {
  constructor(private readonly quizzService: QuizzService) {}

  @GrpcMethod('QuizzService', 'CreateQuizz')
  async createQuizz(data: CreateQuizzDto) {
    return await this.quizzService.createQuizz(data);
  }

  @GrpcMethod('QuizzService', 'GetQuizz')
  async getQuizz(data: GetQuizzDto) {
    return await this.quizzService.getQuizzById(data.quiz_id);
  }

  @GrpcMethod('QuizzService', 'ListQuizzes')
  async listQuizzes(data: ListQuizzesDto) {
    return await this.quizzService.listQuizzes(
      data.page,
      data.limit,
      data.roomId,
      data.createdBy,
    );
  }

  @GrpcMethod('QuizzService', 'UpdateQuizz')
  async updateQuizz(data: UpdateQuizzDto & { quiz_id: string }) {
    return await this.quizzService.updateQuizzById(data.quiz_id, data);
  }

  @GrpcMethod('QuizzService', 'DeleteQuizz')
  async deleteQuizz(data: DeleteQuizzDto & { quiz_id: string }) {
    return await this.quizzService.deleteQuizzById(data.quiz_id);
  }

  @GrpcMethod('QuizzService', 'SubmitQuizz')
  async submitQuizz(data: SubmitQuizzDto) {
    return await this.quizzService.submitQuizz(data.quiz_id, data.answer);
  }

  @GrpcMethod('QuizzService', 'GetQuizzResults')
  async getQuizzResults(data: { quiz_id: string; user_id?: string }) {
    return await this.quizzService.getQuizzResults(data.quiz_id, data.user_id);
  }

  @GrpcMethod('QuizzService', 'GetQuizzesByIds')
  async getQuizzesByIds(data: { quizIds: string[] }) {
    return await this.quizzService.getQuizzesByIds(data.quizIds);
  }
}
