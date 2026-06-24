import { Controller, Inject, Logger } from '@nestjs/common';
import { AIService } from './ai.service';
import { ClientKafka, GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';
import { SearchMessagesDto } from '@app/dto/ai.dto';
import type { MulterFile } from '@app/dto';
import { AiLogUseService, AI_KAFKA_CLIENT } from './ai-log-use.service';
import type { AiLogUsagePayload } from './ai-log-use.service';
import Utils from '@app/helpers/utils';
import { map } from 'rxjs/operators';

@Controller()
export class AIController {
  private readonly logger = new Logger(AIController.name);
  constructor(
    private readonly service: AIService,
    private readonly embeddingService: EmbeddingService,
    private readonly aiLogUseService: AiLogUseService,
    @Inject(AI_KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  @GrpcMethod('AIService', 'Moderation')
  async moderation(data: { text: string; userId: string }) {
    return await this.service.checkMessage(data.text, data.userId);
  }

  @MessagePattern(KafkaEvent.AI_CHAT_MSG_EMBEDDING)
  async createChatMessageEmbedding(data: {
    text: string;
    roomId: string;
    messageId: string;
  }) {
    return await this.embeddingService.createChatMessageEmbedding(
      data.text,
      data.roomId,
      data.messageId,
    );
  }

  @MessagePattern(KafkaEvent.AI_DOC_EMBEDDING)
  async createDocumentEmbedding(data: {
    text: string;
    docId: string;
    userId: string;
  }) {
    return await this.embeddingService.createEmbedding({
      text: data.text,
      contextId: data.docId,
      contextType: 'doc',
      service: 'document',
      userId: data.userId,
      replaceOld: true,
    });
  }

  @MessagePattern(KafkaEvent.AI_PROCESS_FILE_EMBEDDING)
  async processFileEmbedding(data: {
    fileUrl: string;
    fileType: string;
    docId: string;
    userId: string;
    mimeType: string;
    messageId: string;
  }) {
    // 1. Tóm tắt THẬT nội dung file (tải file từ URL rồi cho AI tóm tắt).
    //    Trước đây hàm này nhét thẳng `fileUrl` làm text embedding → pipeline
    //    getMsg đọc ra "summary" chính là cái link, nên FE chỉ thấy link chứ
    //    không có tóm tắt. Giờ embed nội dung tóm tắt thật.
    let summaryText = '';
    try {
      const res: any = await this.service.summaryDocument(
        'file_url',
        undefined,
        data.fileUrl,
        null,
        data.userId,
      );
      summaryText = String(res?.metadata?.summary ?? '').trim();
    } catch (err) {
      this.logger.error(
        `summaryDocument failed for attachment ${data.docId}`,
        err as Error,
      );
    }

    // Không tóm tắt được → KHÔNG lưu link làm summary (đó chính là bug cũ).
    if (!summaryText) {
      this.logger.warn(
        `Empty summary for attachment ${data.docId} — skip embedding`,
      );
      return;
    }

    // 2. Embed bản tóm tắt (vừa hiển thị summary, vừa phục vụ semantic search).
    await this.embeddingService.createEmbedding({
      text: summaryText,
      contextId: data.docId,
      contextType: 'file',
      service: 'document',
      userId: data.userId,
      messageId: data.messageId,
      replaceOld: true,
    });

    // 3. Báo cho chat service re-fetch message + broadcast MSGUPSERT qua redis
    //    adapter để bong bóng tin nhắn cập nhật summary realtime, không phải chờ
    //    người dùng tải lại tin nhắn.
    if (data.messageId) {
      await Utils.dispatchEventKafka(
        this.kafkaClient,
        KafkaEvent.FILE_SUMMARY_READY,
        { messageId: data.messageId },
      );
    }
  }

  @GrpcMethod('AIService', 'SearchMessages')
  async searchMessages(data: SearchMessagesDto & { userId?: string }) {
    return await this.embeddingService.searchSimilarMessages(
      data.text,
      data.roomId,
      data.limit,
      data.userId,
    );
  }

  @GrpcMethod('AIService', 'Search')
  async search(data: {
    query: string;
    userId: string;
    limit: number;
    roomId?: string;
  }) {
    // Nếu có roomId -> Tìm kiếm tin nhắn trong phòng
    if (data.roomId) {
      const results = await this.embeddingService.searchSimilarMessages(
        data.query,
        data.roomId,
        data.limit || 5,
      );

      return { results };
    }

    // Mặc định tìm kiếm tài liệu
    const results = await this.embeddingService.searchSimilarDocuments(
      data.query,
      data.userId,
      data.limit || 5,
    );

    return { results };
  }

  @GrpcMethod('AIService', 'SuggestReplies')
  async suggestReplies(data: {
    contextMessages: string[];
    userId: string;
  }): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }> {
    const result = await this.service.suggestReplies(
      data.contextMessages,
      data.userId,
    );
    return result;
  }

  @GrpcMethod('AIService', 'SummaryDocument')
  async summaryDocument(data: {
    /** Nguồn dữ liệu: 'document' (file đính kèm) hoặc 'file_url' */
    type: 'document' | 'file_url';
    /** File đính kèm (chỉ dùng khi type = 'document') */
    file?: MulterFile;
    /** URL file nguồn (chỉ dùng khi type = 'file_url') */
    file_url?: string;
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
    userId: string;
  }) {
    return await this.service.summaryDocument(data.type, data.file, data.file_url, data.model, data.userId);
  }

  @GrpcMethod('AIService', 'Translation')
  async translation(data: {
    text: string;
    from: string;
    to: string;
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
    userId: string;
  }) {
    return await this.service.translation(data.text, data.from, data.to, data.model, data.userId);
  }

  @GrpcMethod('AIService', 'Quizz')
  async quizz(data: {
    file?: MulterFile;
    text: string;
    type: 'text' | 'document';
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';
    question_max: number; // số lượng câu hỏi tối đa
    question_max_points: number; // điểm số tối đa cho bài trắc nghiệm
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
    userId: string;
  }) {
    return await this.service.generateQuizz(
      data.file,
      data?.text || '',
      data.type,
      data.question_type,
      data.question_max,
      data.question_max_points,
      data.model,
      data.userId,
    );
  }

  /**
   * Speech-to-Text on an existing voice-message attachment.
   * Audio is fetched server-side from S3 — FE only sends IDs.
   */
  @GrpcMethod('AIService', 'TranscribeAttachment')
  async transcribeAttachment(data: {
    attachmentId: string;
    messageId: string;
    language: 'vi' | 'en';
    userId: string;
  }) {
    return this.service.transcribeAttachment(
      data.attachmentId,
      data.messageId,
      data.language || 'vi',
      data.userId,
    );
  }

  @GrpcMethod('AIService', 'TranscribeRealtime')
  async transcribeRealtime(data: {
    audioChunk: Buffer | Uint8Array | string;
    mimeType: string;
    language: string;
    userId: string;
    speakerName: string;
  }) {
    const audioChunk = Buffer.isBuffer(data.audioChunk)
      ? data.audioChunk
      : Buffer.from(data.audioChunk || []);

    return this.service.transcribeRealtime(
      audioChunk,
      data.mimeType,
      data.language === 'en' ? 'en' : 'vi',
      data.userId,
      data.speakerName,
    );
  }

  @GrpcMethod('AIService', 'GenerateFlashcard')
  async generateFlashcard(data: {
    /** Chủ đề hoặc nội dung văn bản để tạo flashcard (dùng khi type = 'text') */
    topic: string;
    /** Nguồn dữ liệu: 'text', 'document' (file đính kèm), hoặc 'file_url' */
    type: 'text' | 'document' | 'file_url';
    /** Số lượng flashcard cần tạo */
    card_count: number;
    /** Độ khó (1 = dễ nhất, 5 = khó nhất) */
    difficulty: number;
    /** Ngôn ngữ đầu ra, ví dụ: 'vi', 'en' */
    language: string;
    /** File đính kèm (chỉ dùng khi type = 'document') */
    file?: MulterFile;
    /** URL file nguồn (chỉ dùng khi type = 'file_url') */
    file_url?: string;
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
    userId: string;
  }) {
    return await this.service.generateFlashcard(
      data.topic,
      data.type,
      data.card_count ?? 10,
      data.difficulty ?? 3,
      data.language ?? 'vi',
      data.file,
      data.file_url,
      data.model,
      data.userId,
    );
  }

  @GrpcMethod('AIService', 'SummaryDocumentStream')
  async summaryDocumentStream(data: {
    type: 'document' | 'file_url';
    file?: MulterFile;
    file_url?: string;
    model?: string | null;
    userId: string;
  }) {
    const observable = await this.service.summaryDocumentStream(data.type, data.file, data.file_url, data.model, data.userId);
    return observable.pipe(map(chunk => ({ chunk })));
  }

  @GrpcMethod('AIService', 'QuizzStream')
  async quizzStream(data: {
    file?: MulterFile;
    text: string;
    type: 'text' | 'document';
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';
    question_max: number;
    question_max_points: number;
    model?: string | null;
    userId: string;
  }) {
    const observable = this.service.generateQuizzStream(
      data.file, data.text || '', data.type, data.question_type, data.question_max, data.question_max_points, data.model, data.userId
    );
    return observable.pipe(map(chunk => ({ chunk })));
  }

  @GrpcMethod('AIService', 'GenerateFlashcardStream')
  async generateFlashcardStream(data: {
    topic: string;
    type: 'text' | 'document' | 'file_url';
    card_count: number;
    difficulty: number;
    language: string;
    file?: MulterFile;
    file_url?: string;
    model?: string | null;
    userId: string;
  }) {
    const observable = await this.service.generateFlashcardStream(
      data.topic,
      data.type,
      data.card_count ?? 10,
      data.difficulty ?? 3,
      data.language ?? 'vi',
      data.file,
      data.file_url,
      data.model,
      data.userId,
    );
    return observable.pipe(map(chunk => ({ chunk })));
  }

  @GrpcMethod('AIService', 'GetUsageReport')
  async getUsageReport(data: {
    service?: string;
    userId?: string;
    from?: string;
    to?: string;
    groupBy: string;
  }) {
    const report = await this.aiLogUseService.getUsageReport({
      service: data.service,
      userId: data.userId,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      groupBy: (data.groupBy as 'service' | 'userId' | 'day') ?? 'service',
    });
    return report;
  }

  @MessagePattern(KafkaEvent.AI_LOG_USAGE)
  async handleAiLogUsage(payload: AiLogUsagePayload) {
    await this.aiLogUseService.writeLogToDb(payload);
  }
}
