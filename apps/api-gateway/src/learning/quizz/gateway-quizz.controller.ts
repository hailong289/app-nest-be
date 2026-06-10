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
import {
  CreateQuizzDto,
  DeleteQuizzDto,
  GetQuizzDto,
  ListQuizzesDto,
  UpdateQuizzDto,
} from 'apps/learning/src/quizz/dto/quizz.dto';
import { Observable } from 'rxjs';
import { GatewayService } from '../../gateway/gateway.service';
import type { AuthenticatedRequest } from 'libs/types/auth.type';

interface QuizzGrpcService {
  CreateQuizz(data: CreateQuizzDto): Observable<any>;
  GetQuizz(data: GetQuizzDto): Observable<any>;
  ListQuizzes(data: ListQuizzesDto): Observable<any>;
  UpdateQuizz(data: UpdateQuizzDto & { quiz_id: string }): Observable<any>;
  DeleteQuizz(data: DeleteQuizzDto & { quiz_id: string }): Observable<any>;
  GetQuizzResults(data: { quiz_id: string; user_id?: string }): Observable<any>;
  SubmitQuizz(data: {
    quiz_id: string;
    answer: {
      userId: string;
      answers: {
        question_index: number;
        selected_answer_indices: number[];
        text_answer?: string;
        is_correct?: boolean;
        points_earned?: number;
        answered_at?: string;
      }[];
      time_taken?: number;
      started_at?: string;
      total_score?: number;
      max_score?: number;
      correct_count?: number;
      total_questions?: number;
      completed_at?: string;
      is_completed?: boolean;
      is_submitted?: boolean;
    };
  }): Observable<any>;
}

@Controller('learning/quizz')
export class GatewayQuizzController {
  private quizzService: QuizzGrpcService;
  constructor(
    @Inject(SERVICES.LEARNING) private readonly learningClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {
    this.quizzService =
      this.learningClient.getService<QuizzGrpcService>('QuizzService');
  }

  @Post('create')
  async createQuizz(
    @Body() body: CreateQuizzDto,
    @Req() req: AuthenticatedRequest
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.CreateQuizz.bind(this.quizzService),
      {
        ...body,
        quiz_createdBy: req.user._id
      },
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
    @Query('roomId') roomId: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.ListQuizzes.bind(this.quizzService),
      { roomId, page, limit, createdBy: req.user._id },
    );
  }

  @Get(':quiz_id')
  async getQuizzByIdAlias(@Param('quiz_id') quiz_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.GetQuizz.bind(this.quizzService),
      { quiz_id },
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

  @Get(':quiz_id/results')
  async getQuizzResults(
    @Param('quiz_id') quiz_id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.GetQuizzResults.bind(this.quizzService),
      { quiz_id, user_id: req.user._id },
    );
  }

  @Post(':quiz_id/submit')
  async submitQuizz(
    @Param('quiz_id') quiz_id: string,
    @Body()
    body: {
      user_answers: {
        question_index: number;
        selected_answer_indices: number[];
        text_answer?: string;
        is_correct?: boolean;
        points_earned?: number;
        answered_at?: string;
      }[];
      total_score?: number;
      max_score?: number;
      correct_count?: number;
      total_questions?: number;
      started_at?: string;
      completed_at?: string;
      time_taken?: number;
      is_completed?: boolean;
      is_submitted?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.quizzService.SubmitQuizz.bind(this.quizzService),
      {
        quiz_id,
        answer: {
          userId: req.user._id,
          answers: body.user_answers,
          time_taken: body.time_taken,
          started_at: body.started_at,
          total_score: body.total_score,
          max_score: body.max_score,
          correct_count: body.correct_count,
          total_questions: body.total_questions,
          completed_at: body.completed_at,
          is_completed: body.is_completed,
          is_submitted: body.is_submitted,
        },
      },
    );
  }
}
