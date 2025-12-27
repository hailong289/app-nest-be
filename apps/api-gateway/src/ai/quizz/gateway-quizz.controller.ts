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
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import {
  CreateQuizzDto,
  DeleteQuizzDto,
  GetQuizzDto,
  ListQuizzesDto,
  UpdateQuizzDto,
} from 'apps/ai/src/quizz/dto/quizz.dto';
import { Observable } from 'rxjs';
import { GatewayService } from '../../gateway/gateway.service';

interface QuizzGrpcService {
  CreateQuizz(data: CreateQuizzDto): Observable<any>;
  GetQuizz(data: GetQuizzDto): Observable<any>;
  ListQuizzes(data: ListQuizzesDto): Observable<any>;
  UpdateQuizz(data: UpdateQuizzDto & { quiz_id: string }): Observable<any>;
  DeleteQuizz(data: DeleteQuizzDto & { quiz_id: string }): Observable<any>;
}

@Controller('ai/quizz')
export class GatewayQuizzController {
  private quizzService: QuizzGrpcService;
  constructor(
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {
    this.quizzService =
      this.aiClient.getService<QuizzGrpcService>('QuizzService');
  }

  @Post('create')
  async createQuizz(@Body() body: CreateQuizzDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.CreateQuizz.bind(this.quizzService),
      body,
    );
  }

  @Get('get/:quiz_id')
  async getQuizz(@Param('quiz_id') quiz_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.GetQuizz.bind(this.quizzService),
      { quiz_id },
    );
  }

  @Get('list')
  async listQuizzes(
    @Query('page') page: number,
    @Query('limit') limit: number,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.ListQuizzes.bind(this.quizzService),
      { page, limit },
    );
  }

  @Patch('update/:quiz_id')
  async updateQuizz(
    @Param('quiz_id') quiz_id: string,
    @Body() body: UpdateQuizzDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.UpdateQuizz.bind(this.quizzService),
      { quiz_id, ...body },
    );
  }

  @Delete('delete/:quiz_id')
  async deleteQuizz(@Param('quiz_id') quiz_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.DeleteQuizz.bind(this.quizzService),
      { quiz_id },
    );
  }
}
