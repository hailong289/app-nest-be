import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLog } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';
import { Response } from '@app/helpers/response';
import { EmbeddingService } from './embedding.service';
import { Message } from 'libs/db/src';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    private readonly embeddingService: EmbeddingService,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
  ) {}

  async checkMessage(text: string, userId: string, contextId?: string) {
    const result = await this.googleProvider.moderate(text);
    return result;
  }

  async searchMessages(text: string, roomId: string, limit: number) {
    const result = await this.embeddingService.searchSimilarMessages(
      text,
      limit,
      roomId,
    );
    // Nếu embedding không tìm thấy kết quả thì tìm kiếm trong database
    if (result.length > 0) {
      return result;
    }
    const messages = await this.messageModel.find({
      msg_roomId: roomId,
      msg_content: { $regex: new RegExp(text, 'i') },
    });
    return messages;
  }
}
