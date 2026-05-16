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
  Res,
  Sse,
  MessageEvent,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Response } from 'express';
import { GatewayService } from '../gateway/gateway.service';
import {
  GenerateFlashcardDto,
  ModerationDto,
  SearchMessagesDto,
  SummaryDocumentDto,
  TranslationDto,
  QuizzDto,
  TranscribeAttachmentDto,
} from '@app/dto/ai.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterFile } from '@app/dto';
import type { AuthenticatedRequest } from 'libs/types/auth.type';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { wrapUnaryGrpcAsSse } from './sse-ai.helpers';
interface AiGrpcService {
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
    type: 'text' | 'document' | 'file_url';
    card_count: number;
    difficulty: number;
    language: string;
    file?: unknown;
    file_url?: string;
    model?: string | null;
    userId?: string;
  }): Observable<unknown>;
  summaryDocumentStream(data: SummaryDocumentDto): Observable<{ chunk: string }>;
  quizzStream(data: QuizzDto): Observable<{ chunk: string }>;
  generateFlashcardStream(data: {
    topic: string;
    type: 'text' | 'document' | 'file_url';
    card_count: number;
    difficulty: number;
    language: string;
    file?: unknown;
    file_url?: string;
    model?: string | null;
    userId?: string;
  }): Observable<{ chunk: string }>;
  transcribeAttachment(data: TranscribeAttachmentDto): Observable<unknown>;
  getUsageReport(data: {
    service?: string;
    userId?: string;
    from?: string;
    to?: string;
    groupBy: string;
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

  private initSseResponse(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (
      typeof (res as Response & { flushHeaders?: () => void }).flushHeaders ===
      'function'
    ) {
      (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
    }
  }

  @Post('moderation')
  async moderation(
    @Body() body: ModerationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: ModerationDto & { userId: string }) =>
        this.aiService.moderation({ ...data, userId: req.user.usr_id }),
      { ...body, userId: req.user.usr_id },
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

  /**
   * POST /ai/search — hybrid AI search (vector embedding + keyword) over a
   * user's accessible messages. Body: `{ query, roomId?, limit? }`.
   * `userId` is taken from the authenticated request, not the body.
   */
  @Post('search')
  async search(
    @Body() body: { query: string; roomId?: string; limit?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: {
        query: string;
        userId: string;
        limit: number;
        roomId?: string;
      }) => this.aiService.search(data),
      {
        query: body.query,
        userId: req.user.usr_id,
        limit: body.limit ?? 5,
        roomId: body.roomId,
      },
      60000, // 1 minute — embedding + vector search may be slow on cold cache
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
  async summaryDocument(
    @UploadedFile() file: MulterFile,
    @Body() body: { type: 'document' | 'file_url'; file_url?: string; model?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: SummaryDocumentDto & { userId: string }) =>
        this.aiService.summaryDocument({ ...data, userId: req.user.usr_id }),
      { file, type: body.type, file_url: body.file_url, model: body.model, userId: req.user.usr_id },
      120000, // 2 minutes timeout
    );
  }

  @Post('translation')
  async translation(
    @Body() body: TranslationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: TranslationDto & { userId: string }) =>
        this.aiService.translation({ ...data, userId: req.user.usr_id }),
      { ...body, userId: req.user.usr_id },
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
      model?: string | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: QuizzDto & { userId: string }) =>
        this.aiService.quizz({ ...data, userId: req.user.usr_id }),
      {
        file: file,
        text: body?.text || '',
        type: body.type,
        question_type: body.question_type,
        question_max: body.question_max,
        question_max_points: body.question_max_points,
        model: body.model,
        userId: req.user.usr_id,
      },
      100000, // 1 minute timeout
    );
  }

  /**
   * POST /ai/generate-flashcard
   * Tạo flashcard tự động bằng AI từ văn bản hoặc tài liệu đính kèm.
   * Body (multipart/form-data):
   *   - topic      : string  — nội dung / chủ đề (khi type='text')
   *   - type       : 'text' | 'document' | 'file_url'
   *   - card_count : number  — số lượng thẻ (1–50, default: 10)
   *   - difficulty : number  — độ khó 1–5 (default: 3)
   *   - language   : string  — ngôn ngữ đầu ra (default: 'vi')
   *   - file       : File    — file đính kèm (khi type='document')
   *   - file_url   : string  — URL file nguồn (khi type='file_url')
   */
  @Post('generate-flashcard')
  @UseInterceptors(FileInterceptor('file'))
  async generateFlashcard(
    @UploadedFile() file: MulterFile,
    @Body()
    body: {
      topic: string;
      type: 'text' | 'document' | 'file_url';
      card_count: number;
      difficulty: number;
      language: string;
      file_url?: string;
      model?: string | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: {
        topic: string;
        type: 'text' | 'document' | 'file_url';
        card_count?: number;
        difficulty?: number;
        language?: string;
        file?: MulterFile;
        file_url?: string;
        model?: string | null;
        userId: string;
      }) =>
        this.aiService.generateFlashcard({
          topic: data.topic ?? '',
          type: data.type,
          card_count: Number(data.card_count) || 10,
          difficulty: Number(data.difficulty) || 3,
          language: data.language || 'vi',
          file: data.file,
          file_url: data.file_url,
          model: data.model,
          userId: data.userId,
        }),
      { ...body, file, file_url: body.file_url, model: body.model, userId: req.user.usr_id },
      180000, // 3 minutes timeout (AI cần thời gian tạo nhiều thẻ)
    );
  }

  @Post('stream/summary-document')
  @UseInterceptors(FileInterceptor('file'))
  summaryDocumentStream(
    @UploadedFile() file: MulterFile,
    @Body() body: { type: 'document' | 'file_url'; file_url?: string; model?: string | null },
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);

    const stream = this.aiService.summaryDocumentStream({
      file,
      type: body.type,
      file_url: body.file_url,
      model: body.model,
      userId: req.user.usr_id,
    } as SummaryDocumentDto & { userId: string });

    const sub = stream.subscribe({
      next: (item: { chunk: string }) => {
        res.write(`data: ${item?.chunk || ''}\n\n`);
      },
      error: (err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      },
      complete: () => {
        res.end();
      },
    });

    res.on('close', () => {
      sub.unsubscribe();
    });
  }

  @Post('stream/quizz')
  @UseInterceptors(FileInterceptor('file'))
  quizzStream(
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
      model?: string | null;
    },
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);

    const stream = this.aiService.quizzStream({
      file: file,
      text: body?.text || '',
      type: body.type,
      question_type: body.question_type,
      question_max: Number(body.question_max),
      question_max_points: Number(body.question_max_points),
      model: body.model,
      userId: req.user.usr_id,
    } as QuizzDto & { userId: string });

    const sub = stream.subscribe({
      next: (item: { chunk: string }) => {
        res.write(`data: ${item?.chunk || ''}\n\n`);
      },
      error: (err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      },
      complete: () => {
        res.end();
      },
    });

    res.on('close', () => {
      sub.unsubscribe();
    });
  }

  @Post('stream/generate-flashcard')
  @UseInterceptors(FileInterceptor('file'))
  generateFlashcardStream(
    @UploadedFile() file: MulterFile,
    @Body()
    body: {
      topic: string;
      type: 'text' | 'document' | 'file_url';
      card_count: number;
      difficulty: number;
      language: string;
      file_url?: string;
      model?: string | null;
    },
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);

    const stream = this.aiService.generateFlashcardStream({
      topic: body.topic ?? '',
      type: body.type,
      card_count: Number(body.card_count) || 10,
      difficulty: Number(body.difficulty) || 3,
      language: body.language || 'vi',
      file: file as MulterFile,
      file_url: body.file_url,
      model: body.model,
      userId: req.user.usr_id,
    });

    const sub = stream.subscribe({
      next: (item: { chunk: string }) => {
        res.write(`data: ${item?.chunk || ''}\n\n`);
      },
      error: (err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      },
      complete: () => {
        res.end();
      },
    });

    res.on('close', () => {
      sub.unsubscribe();
    });
  }

  /** SSE unary-wrap: same contract as POST /ai/search */
  @Post('stream/search')
  searchStream(
    @Body() body: { query: string; roomId?: string; limit?: number },
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);
    void this.gatewayService
      .dispatchGrpcRequest(
        (data: {
          query: string;
          userId: string;
          limit: number;
          roomId?: string;
        }) => this.aiService.search(data),
        {
          query: body.query,
          userId: req.user.usr_id,
          limit: body.limit ?? 5,
          roomId: body.roomId,
        },
        60000,
      )
      .then((result) => {
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();
      })
      .catch((err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      });
  }

  @Post('stream/suggest-replies')
  suggestRepliesStream(
    @Body() body: { contextMessages: string[] },
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);
    void this.gatewayService
      .dispatchGrpcRequest(
        (data: { contextMessages: string[]; userId: string }) =>
          this.aiService.suggestReplies(data),
        {
          contextMessages: body.contextMessages,
          userId: req.user.usr_id,
        },
        100000,
      )
      .then((result) => {
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();
      })
      .catch((err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      });
  }

  @Post('stream/translation')
  translationStream(
    @Body() body: TranslationDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);
    void this.gatewayService
      .dispatchGrpcRequest(
        (data: TranslationDto & { userId: string }) =>
          this.aiService.translation(data),
        { ...body, userId: req.user.usr_id },
        100000,
      )
      .then((result) => {
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();
      })
      .catch((err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      });
  }

  @Post('stream/moderation')
  moderationStream(
    @Body() body: ModerationDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.initSseResponse(res);
    void this.gatewayService
      .dispatchGrpcRequest(
        (data: ModerationDto & { userId: string }) =>
          this.aiService.moderation(data),
        { ...body, userId: req.user.usr_id },
        120000,
      )
      .then((result) => {
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();
      })
      .catch((err: unknown) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      });
  }

  /** SSE unary-wrap: same semantics as GET /ai/search-messages (EventSource-friendly GET). */
  @Get('stream/search-messages')
  @Sse()
  searchMessagesStream(
    @Query() query: SearchMessagesDto,
    @Req() req: AuthenticatedRequest,
  ): Observable<MessageEvent> {
    return wrapUnaryGrpcAsSse(
      () =>
        this.gatewayService.dispatchGrpcRequest(
          (data: SearchMessagesDto & { userId: string }) =>
            this.aiService.searchMessages(data),
          { ...query, userId: req.user.usr_id },
          60000,
        ),
      'ai/stream/search-messages',
    );
  }
  /**
   * POST /ai/transcribe-attachment
   * Speech-to-Text on an existing voice-message audio attachment.
   * Body (JSON):
   *   - attachmentId : ObjectId của Attachment cần transcribe
   *   - messageId    : ObjectId của Message chứa attachment đó
   *   - language     : 'vi' | 'en' (mặc định 'vi')
   *
   * Audio đã ở S3 nên FE KHÔNG upload lại file — AI service tự fetch từ
   * URL của attachment, gửi vào Gemini, lưu transcript vào Attachment
   * record và trả về { transcript, detectedLanguage, cached }.
   *
   * Idempotent: nếu attachment đã có transcript, trả về luôn từ cache
   * mà không gọi Gemini.
   */
  @Post('transcribe-attachment')
  async transcribeAttachment(
    @Body()
    body: {
      attachmentId: string;
      messageId: string;
      language?: 'vi' | 'en';
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: TranscribeAttachmentDto) =>
        this.aiService.transcribeAttachment(data),
      {
        attachmentId: body.attachmentId,
        messageId: body.messageId,
        language: body.language || 'vi',
        userId: req.user.usr_id,
      },
      120000, // 2 minutes — Gemini may be slow on long audio
    );
  }

  /**
   * GET /ai/usage/report
   *
   * API report thống kê AI usage.
   * Query params (tất cả đều optional):
   *   - service : lọc theo loại service (moderation, translation, suggest-replies, ...)
   *   - from    : ngày bắt đầu (ISO string)
   *   - to      : ngày kết thúc (ISO string)
   *   - groupBy : 'service' | 'userId' | 'day' (mặc định: 'service')
   *
   * Mặc định luôn lọc theo userId của user đang đăng nhập.
   * Gọi xuống AI service qua gRPC method GetUsageReport.
   */
  @Get('usage/report')
  async getUsageReport(
    @Query()
    queryParams: {
      service?: string;
      from?: string;
      to?: string;
      groupBy?: 'service' | 'userId' | 'day';
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data: {
        service?: string;
        userId: string;
        from?: string;
        to?: string;
        groupBy: string;
      }) => this.aiService.getUsageReport(data),
      {
        service: queryParams.service,
        userId: req.user.usr_id,
        from: queryParams.from,
        to: queryParams.to,
        groupBy: queryParams.groupBy ?? 'service',
      },
      30000, // 30 seconds
    );
  }
}
