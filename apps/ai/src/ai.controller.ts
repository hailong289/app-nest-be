import { Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod, MessagePattern } from '@nestjs/microservices';
import { EmbeddingService } from './embedding.service';

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

  @MessagePattern('ai.createChatMessageEmbedding')
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
}
