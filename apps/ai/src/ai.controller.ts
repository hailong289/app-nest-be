import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';
import { SearchMessagesDto } from '@app/dto/ai.dto';
import type { MulterFile } from '@app/dto';

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
    file: Uint8Array;
    filename?: string;
    mimetype?: string;
  }) {
    // Rehydrate Multer-like file from gRPC payload
    const mime = data.mimetype || 'application/octet-stream';
    const file: MulterFile = {
      fieldname: 'file',
      originalname: data.filename || 'document',
      encoding: '7bit',
      mimetype: mime,
      size: data.file?.length || 0,
      buffer: Buffer.from(data.file || []),
    } as unknown as MulterFile;

    return await this.service.summaryDocument(file);
  }

  @GrpcMethod('AIService', 'Translation')
  async translation(data: { text: string; from: string; to: string }) {
    return await this.service.translation(data.text, data.from, data.to);
  }

  @GrpcMethod('AIService', 'Quizz')
  async quizz(data: {
    file?: {
      buffer?: Uint8Array;
      originalname?: string;
      mimetype?: string;
      fieldname?: string;
      encoding?: string;
      size?: number;
    };
    text: string;
    type: 'text' | 'document';
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';
    question_max: number; // số lượng câu hỏi tối đa
    question_max_points: number; // điểm số tối đa cho bài trắc nghiệm
  }) {
    const file: MulterFile | undefined = data.file
      ? {
          fieldname: data.file.fieldname || 'file',
          originalname: data.file.originalname || 'document',
          encoding: data.file.encoding || '7bit',
          mimetype: data.file.mimetype || 'application/octet-stream',
          size: data.file.size || data.file.buffer?.length || 0,
          buffer: Buffer.from(data.file.buffer || []),
        }
      : undefined;

    return await this.service.generateQuizz(
      file as MulterFile,
      data?.text || '',
      data.type,
      data.question_type,
      data.question_max,
      data.question_max_points,
    );
  }
}
