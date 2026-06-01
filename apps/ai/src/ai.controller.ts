import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';
import { SearchMessagesDto } from '@app/dto/ai.dto';
import type {
  AiChatMessageEmbeddingPayload,
  AiDocumentEmbeddingPayload,
  AiFileEmbeddingPayload,
} from '@app/dto/ai.dto';
import type { MulterFile } from '@app/dto';
import { AiLogUseService } from './ai-log-use.service';
import type { AiLogUsagePayload } from './ai-log-use.service';
import { map } from 'rxjs/operators';

@Controller()
export class AIController {
  constructor(
    private readonly service: AIService,
    private readonly embeddingService: EmbeddingService,
    private readonly aiLogUseService: AiLogUseService,
  ) {}

  @GrpcMethod('AIService', 'Moderation')
  async moderation(data: { text: string; userId: string }) {
    return await this.service.checkMessage(data.text, data.userId);
  }

  @MessagePattern(KafkaEvent.AI_CHAT_MSG_EMBEDDING)
  async createChatMessageEmbedding(data: AiChatMessageEmbeddingPayload) {
    if (!data?.text || !data.roomId || !data.messageId) {
      return;
    }
    return await this.embeddingService.createChatMessageEmbedding(
      data.text,
      data.roomId,
      data.messageId,
      {
        userId: data.userId,
        userBusinessId: data.userBusinessId,
        usrId: data.usrId,
        msgType: data.msgType,
        isSystemMessage: data.isSystemMessage,
        createdAt: data.createdAt,
        snapshot: data.snapshot,
      },
    );
  }

  @MessagePattern(KafkaEvent.AI_DOC_EMBEDDING)
  async createDocumentEmbedding(data: AiDocumentEmbeddingPayload) {
    const text = data?.plainText || data?.text;
    if (!text || !data.docId) {
      return;
    }
    return await this.embeddingService.createEmbedding({
      text,
      contextId: data.docId,
      contextType: 'doc',
      service: 'filesystem',
      sourceService: 'filesystem',
      sourceType: 'document',
      sourceId: data.docId,
      userId: data.userId,
      userBusinessId: data.userBusinessId,
      usrId: data.usrId,
      roomIds: data.roomIds,
      visibility: data.visibility,
      snapshot: {
        title: data.title,
        content: text,
        updatedAt: data.updatedAt,
        ...(data.snapshot ?? {}),
      },
      replaceOld: true,
    });
  }

  @MessagePattern(KafkaEvent.AI_PROCESS_FILE_EMBEDDING)
  async processFileEmbedding(data: AiFileEmbeddingPayload) {
    if (!data?.fileUrl || !data.attachmentId) {
      return;
    }
    return await this.embeddingService.processFileEmbedding(data);
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
    return await this.service.summaryDocument(
      data.type,
      data.file,
      data.file_url,
      data.model,
      data.userId,
    );
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
    return await this.service.translation(
      data.text,
      data.from,
      data.to,
      data.model,
      data.userId,
    );
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
    fileUrl?: string;
    mimeType?: string;
    cachedTranscript?: string;
  }) {
    return this.service.transcribeAttachment(
      data.attachmentId,
      data.messageId,
      data.language || 'vi',
      data.userId,
      data.fileUrl,
      data.mimeType,
      data.cachedTranscript,
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
    const observable = await this.service.summaryDocumentStream(
      data.type,
      data.file,
      data.file_url,
      data.model,
      data.userId,
    );
    return observable.pipe(map((chunk) => ({ chunk })));
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
      data.file,
      data.text || '',
      data.type,
      data.question_type,
      data.question_max,
      data.question_max_points,
      data.model,
      data.userId,
    );
    return observable.pipe(map((chunk) => ({ chunk })));
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
    return observable.pipe(map((chunk) => ({ chunk })));
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
