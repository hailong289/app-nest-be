import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';

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
    return await this.embeddingService.processFileEmbedding(
      data.fileUrl,
      data.fileType,
      data.docId,
      data.userId,
      data.mimeType,
      data.messageId,
    );
  }
}
