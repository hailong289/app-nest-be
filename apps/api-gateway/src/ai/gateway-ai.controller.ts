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
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import {
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
import { memoryStorage } from 'multer';
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
}

type AiSearchPayload = {
  query: string;
  userId: string;
  limit: number;
  roomId?: string;
};

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

  @Post('search')
  async search(
    @Body()
    body: {
      query: string;
      roomId?: string;
      limit?: number;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: AiSearchPayload) => this.aiService.search(data),
      {
        query: body.query,
        userId: req.user.usr_id,
        limit: body.limit ?? 5,
        roomId: body.roomId,
      },
    );
  }

  @Post('summary-document')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async summaryDocument(@UploadedFile() file: MulterFile) {
    console.log('SummaryDocument request:', file);
    // Tăng timeout lên 2 phút (120000ms) cho xử lý document lớn
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.gatewayService.dispatchGrpcRequest(
      (data: SummaryDocumentDto) => this.aiService.summaryDocument(data),
      {
        file: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
      },
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
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

    if (body.type === 'document' && !file) {
      throw new BadRequestException('File is required for document quizzes');
    }

    return this.gatewayService.dispatchGrpcRequest(
      (data: QuizzDto) => this.aiService.quizz(data),
      Object.assign(
        {
          text: body?.text || '',
          type: body.type,
          question_type: body.question_type,
          question_max: body.question_max,
          question_max_points: body.question_max_points,
        },
        file
          ? {
              file: {
                buffer: file.buffer,
                originalname: file.originalname,
                mimetype: file.mimetype,
                fieldname: file.fieldname,
                encoding: file.encoding,
                size: file.size,
              },
            }
          : {},
      ) as unknown as QuizzDto,
      100000, // 1 minute timeout
    );
  }
}
