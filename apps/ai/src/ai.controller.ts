import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';
import { KafkaEvent } from '@app/dto/enum.type';
import { SearchMessagesDto } from '@app/dto/ai.dto';
import type { MulterFile } from '@app/dto';
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

  @MessagePattern(KafkaEvent.aiMsg)
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

  @GrpcMethod('AIService', 'SearchMessages')
  async searchMessages(data: SearchMessagesDto) {
    return await this.embeddingService.searchSimilarMessages(
      data.text,
      data.limit,
      data.roomId,
    );
  }

  @GrpcMethod('AIService', 'SummaryDocument')
  async summaryDocument(data: { file: MulterFile }) {
    return await this.service.summaryDocument(data.file);
  }

  @GrpcMethod('AIService', 'Translation')
  async translation(data: { text: string; from: string; to: string }) {
    return await this.service.translation(data.text, data.from, data.to);
  }
}
