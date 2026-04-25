import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';
import { EmbeddingService } from './embedding.service';
import { Message } from 'libs/db/src';
import { MulterFile } from '@app/dto';
import axios from 'axios';
import { basename } from 'node:path';

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
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
  ) {
    const result = await this.googleProvider.generateQuizz(
      file,
      text,
      type,
      question_type,
      question_max,
      question_max_points,
    );
    return result;
  }

  async generateFlashcard(
    topic: string,
    type: 'text' | 'document' | 'file_url',
    card_count: number,
    difficulty: number,
    language: string,
    file?: MulterFile,
    file_url?: string,
  ) {
    let inputFile = file;

    if (type === 'file_url' && file_url) {
      inputFile = await this.downloadFileFromUrl(file_url);
    }

    return await this.googleProvider.generateFlashcard(
      topic,
      type,
      card_count,
      difficulty,
      language,
      inputFile,
    );
  }

  private async downloadFileFromUrl(fileUrl: string): Promise<MulterFile> {
    const response = await axios.get(fileUrl, { responseType: 'stream' });
    const chunks: Buffer[] = [];

    for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const filenameFromUrl = basename(new URL(fileUrl).pathname);

    return {
      fieldname: 'file',
      originalname: filenameFromUrl || 'remote-file',
      encoding: '7bit',
      mimetype:
        (response.headers['content-type'] as string) ||
        'application/octet-stream',
      size: buffer.length,
      buffer,
    };
  }
}
