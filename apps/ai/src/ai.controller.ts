import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';
import { SearchMessagesDto } from '@app/dto/ai.dto';
import type { MulterFile } from '@app/dto';
import { AiLogUseService } from './ai-log-use.service';
import type { AiLogUsagePayload } from './ai-log-use.service';
import { map } from 'rxjs/operators';

interface IAIService {
  suggestReplies(messages: string[]): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }>;
  checkMessage(text: string, userId: string): Promise<any>;
}
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
    return await this.embeddingService.createEmbedding({
      text: data.fileUrl,
      contextId: data.docId,
      contextType: 'file',
      service: 'document',
      userId: data.userId,
      replaceOld: true,
    });
  }

  @GrpcMethod('AIService', 'SearchMessages')
  async searchMessages(data: SearchMessagesDto) {
    return await this.embeddingService.searchSimilarMessages(
      data.text,
      data.roomId,
      data.limit,
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
    const result = await (this.service as unknown as IAIService).suggestReplies(
      data.contextMessages,
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
  }) {
    return await this.service.summaryDocument(data.type, data.file, data.file_url, data.model);
  }

  @GrpcMethod('AIService', 'Translation')
  async translation(data: {
    text: string;
    from: string;
    to: string;
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
  }) {
    return await this.service.translation(data.text, data.from, data.to, data.model);
  }

  @GrpcMethod('AIService', 'Quizz')
  async quizz(data: {
    file: MulterFile;
    text: string;
    type: 'text' | 'document';
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';
    question_max: number; // số lượng câu hỏi tối đa
    question_max_points: number; // điểm số tối đa cho bài trắc nghiệm
    /** Model AI tùy chỉnh (null = dùng model mặc định) */
    model?: string | null;
  }) {
    return await this.service.generateQuizz(
      data.file,
      data?.text || '',
      data.type,
      data.question_type,
      data.question_max,
      data.question_max_points,
      data.model,
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
    );
  }

  @GrpcMethod('AIService', 'SummaryDocumentStream')
  async summaryDocumentStream(data: {
    type: 'document' | 'file_url';
    file?: MulterFile;
    file_url?: string;
    model?: string | null;
  }) {
    const observable = await this.service.summaryDocumentStream(data.type, data.file, data.file_url, data.model);
    return observable.pipe(map(chunk => ({ chunk })));
  }

  @GrpcMethod('AIService', 'QuizzStream')
  async quizzStream(data: {
    file: MulterFile;
    text: string;
    type: 'text' | 'document';
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';
    question_max: number;
    question_max_points: number;
    model?: string | null;
  }) {
    const observable = this.service.generateQuizzStream(
      data.file, data.text || '', data.type, data.question_type, data.question_max, data.question_max_points, data.model
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
    );
    return observable.pipe(map(chunk => ({ chunk })));
  }

  @MessagePattern(KafkaEvent.AI_LOG_USAGE)
  async handleAiLogUsage(payload: AiLogUsagePayload) {
    await this.aiLogUseService.writeLogToDb(payload);
  }
}
