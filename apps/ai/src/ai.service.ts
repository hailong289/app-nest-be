import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';
import { EmbeddingService } from './embedding.service';
import { Message } from 'libs/db/src';
import { MulterFile } from '@app/dto';

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

  async suggestReplies(messages: string[]): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }> {
    const result = await this.googleProvider.suggestReplies(messages);
    return result;
  }

  async searchMessages(text: string, roomId: string, limit: number) {
    const result = await this.embeddingService.searchSimilarMessages(
      text,
      roomId,
      limit,
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

  async summaryDocument(file: MulterFile) {
    const result = await this.googleProvider.summaryDocument(file);
    return result;
  }

  async translation(text: string, from: string, to: string) {
    const result = await this.googleProvider.translation(text, from, to);
    return result;
  }

  async generateQuizz(
    file: MulterFile,
    text: string,
    type: 'text' | 'document',
  ) {
    const result = await this.googleProvider.generateQuizz(file, text, type);
    return result;
  }
}
