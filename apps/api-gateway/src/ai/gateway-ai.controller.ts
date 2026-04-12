/*
https://docs.nestjs.com/controllers#controllers
*/

import { SERVICES } from '@app/constants';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import {
  GenerateFlashcardDto,
  ModerationDto,
  SearchMessagesDto,
  SummaryDocumentDto,
  TranslationDto,
  QuizzDto,
} from '@app/dto/ai.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterFile } from '@app/dto';
import type { AuthenticatedRequest } from 'libs/types/auth.type';
import { Observable } from 'rxjs';
interface AiGrpcService {
  // Define AI service methods here
  moderation(data: ModerationDto): Observable<unknown>;
  search(data: {
    query: string;
    userId: string;
    limit: number;
    roomId?: string;
  }): Observable<unknown>;
  suggestReplies(data: {
    contextMessages: string[];
    userId: string;
  }): Observable<unknown>;
  searchMessages(data: SearchMessagesDto): Observable<unknown>;
  summaryDocument(data: SummaryDocumentDto): Observable<unknown>;
  translation(data: TranslationDto): Observable<unknown>;
  quizz(data: QuizzDto): Observable<unknown>;
  generateFlashcard(data: {
    topic: string;
    type: 'text' | 'document';
    card_count: number;
    difficulty: number;
    language: string;
    file?: unknown;
  }): Observable<unknown>;
}

@Controller('ai')
export class GatewayAiController {
  private aiService: AiGrpcService;
  constructor(
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.aiService = this.aiClient.getService<AiGrpcService>('AIService');
  }

  @Post('moderation')
  async moderation(@Body() body: ModerationDto) {
    // Tăng timeout lên 2 phút (120000ms) cho moderation
    return this.gatewayService.dispatchGrpcRequest(
      (data: ModerationDto) => this.aiService.moderation(data),
      body,
      120000, // 2 minutes timeout
    );
  }

  @Post('suggest-replies')
  async suggestReplies(
    @Body() body: { contextMessages: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: { contextMessages: string[]; userId: string }) =>
        this.aiService.suggestReplies(data),
      {
        contextMessages: body.contextMessages,
        userId: req.user.usr_id,
      },
      100000, // 1 minute timeout
    );
  }

  @Get('search-messages')
  async searchMessages(@Query() query: SearchMessagesDto) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: SearchMessagesDto) => this.aiService.searchMessages(data),
      query,
    );
  }

  @Post('summary-document')
  @UseInterceptors(FileInterceptor('file'))
  async summaryDocument(@UploadedFile() file: MulterFile) {
    console.log('SummaryDocument request:', file);
    // Tăng timeout lên 2 phút (120000ms) cho xử lý document lớn
    return this.gatewayService.dispatchGrpcRequest(
      (data: SummaryDocumentDto) => this.aiService.summaryDocument(data),
      { file },
      120000, // 2 minutes timeout
    );
  }

  @Post('translation')
  async translation(@Body() body: TranslationDto) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: TranslationDto) => this.aiService.translation(data),
      body,
      100000, // 1 minute timeout
    );
  }

  @Post('quizz')
  @UseInterceptors(FileInterceptor('file'))
  async quizz(
    @UploadedFile() file: MulterFile,
    @Body()
    body: {
      text: string;
      type: 'text' | 'document';
      question_type:
        | 'single_choice'
        | 'multiple_choice'
        | 'true_false'
        | 'text';
      question_max: number;
      question_max_points: number;
    },
  ) {
    console.log('Quizz request:', { file, body });
    return this.gatewayService.dispatchGrpcRequest(
      (data: QuizzDto) => this.aiService.quizz(data),
      {
        file: file,
        text: body?.text || '',
        type: body.type,
        question_type: body.question_type,
        question_max: body.question_max,
        question_max_points: body.question_max_points,
      },
      100000, // 1 minute timeout
    );
  }

  /**
   * POST /ai/generate-flashcard
   * Tạo flashcard tự động bằng AI từ văn bản hoặc tài liệu đính kèm.
   * Body (multipart/form-data):
   *   - topic      : string  — nội dung / chủ đề (khi type='text')
   *   - type       : 'text' | 'document'
   *   - card_count : number  — số lượng thẻ (1–50, default: 10)
   *   - difficulty : number  — độ khó 1–5 (default: 3)
   *   - language   : string  — ngôn ngữ đầu ra (default: 'vi')
   *   - file       : File    — file đính kèm (khi type='document')
   */
  @Post('generate-flashcard')
  @UseInterceptors(FileInterceptor('file'))
  async generateFlashcard(
    @UploadedFile() file: MulterFile,
    @Body()
    body: {
      topic: string;
      type: 'text' | 'document';
      card_count: number;
      difficulty: number;
      language: string;
    },
  ) {
    console.log('GenerateFlashcard request:', { file, body });
    return this.gatewayService.dispatchGrpcRequest(
      (data: GenerateFlashcardDto & { file?: MulterFile }) =>
        this.aiService.generateFlashcard({
          topic: data.topic ?? '',
          type: data.type,
          card_count: Number(data.card_count) || 10,
          difficulty: Number(data.difficulty) || 3,
          language: data.language || 'vi',
          file: data.file,
        }),
      { ...body, file },
      180000, // 3 minutes timeout (AI cần thời gian tạo nhiều thẻ)
    );
  }
}
