import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';
import { EmbeddingService } from './embedding.service';
import { Message, Attachment } from 'libs/db/src';
import { MulterFile } from '@app/dto';
import { Response } from '@app/helpers/response';
import axios from 'axios';
import { basename } from 'node:path';
import { SfuTranscriptionClient } from './sfu-transcription.client';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    private readonly embeddingService: EmbeddingService,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    private readonly sfuTranscription: SfuTranscriptionClient,
  ) {}

  async checkMessage(text: string, userId: string, contextId?: string) {
    const result = await this.googleProvider.moderate(text, userId);
    return result;
  }

  async suggestReplies(messages: string[], userId: string): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }> {
    const result = await this.googleProvider.suggestReplies(messages, userId);
    return result;
  }

  async searchMessages(text: string, roomId: string, limit: number, userId?: string) {
    const result = await this.embeddingService.searchSimilarMessages(
      text,
      roomId,
      limit,
      userId,
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

  async summaryDocument(
    type: 'document' | 'file_url',
    file?: MulterFile,
    file_url?: string,
    model?: string | null,
    userId?: string,
  ) {
    let inputFile = file;

    if (type === 'file_url' && file_url) {
      inputFile = await this.downloadFileFromUrl(file_url);
    }

    const result = await this.googleProvider.summaryDocument(inputFile, model, userId);
    return result;
  }

  async translation(text: string, from: string, to: string, model?: string | null, userId?: string) {
    const result = await this.googleProvider.translation(text, from, to, model, userId);
    return result;
  }

  async generateQuizz(
    file: MulterFile | undefined,
    text: string,
    type: 'text' | 'document',
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
    model?: string | null,
    userId?: string,
  ) {
    const result = await this.googleProvider.generateQuizz(
      file,
      text,
      type,
      question_type,
      question_max,
      question_max_points,
      model,
      userId,
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
    model?: string | null,
    userId?: string,
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
      model,
      userId,
    );
  }

  async summaryDocumentStream(
    type: 'document' | 'file_url',
    file?: MulterFile,
    file_url?: string,
    model?: string | null,
    userId?: string,
  ) {
    let inputFile = file;

    if (type === 'file_url' && file_url) {
      inputFile = await this.downloadFileFromUrl(file_url);
    }

    return this.googleProvider.summaryDocumentStream(inputFile, model, userId);
  }

  generateQuizzStream(
    file: MulterFile | undefined,
    text: string,
    type: 'text' | 'document',
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
    model?: string | null,
    userId?: string,
  ) {
    return this.googleProvider.generateQuizzStream(
      file,
      text,
      type,
      question_type,
      question_max,
      question_max_points,
      model,
      userId,
    );
  }

  async generateFlashcardStream(
    topic: string,
    type: 'text' | 'document' | 'file_url',
    card_count: number,
    difficulty: number,
    language: string,
    file?: MulterFile,
    file_url?: string,
    model?: string | null,
    userId?: string,
  ) {
    let inputFile = file;

    if (type === 'file_url' && file_url) {
      inputFile = await this.downloadFileFromUrl(file_url);
    }

    return this.googleProvider.generateFlashcardStream(
      topic,
      type,
      card_count,
      difficulty,
      language,
      inputFile,
      model,
      userId,
    );
  }

  /**
   * Speech-to-Text on an existing voice-message attachment.
   *
   * Flow:
   *   1. Look up the Attachment by `attachmentId`. Validate it belongs to
   *      `messageId` and is an audio kind.
   *   2. If `attachment.transcript` is already set, return it as-is
   *      (cached) — STT is expensive and idempotent per attachment.
   *   3. Send the attachment URL to apps/sfu, where Whisper local CPU
   *      downloads/decodes the audio and returns
   *      `{ transcript, detectedLanguage }`.
   *   5. Persist `transcript` + `transcribedAt` on the Attachment.
   *   6. Return the Response.success metadata expected by the proto.
   *
   * NB: The realtime broadcast to other room members is NOT done here —
   * the persisted transcript becomes visible on next message refresh /
   * reload. Live broadcast can be added later via a Kafka event consumed
   * by the socket service.
   */
  async transcribeAttachment(
    attachmentId: string,
    messageId: string,
    language: 'vi' | 'en',
    userId: string,
  ) {
    if (!attachmentId || !messageId) {
      return Response.error(
        'Thiếu attachmentId hoặc messageId',
        400,
        'BAD_REQUEST',
      );
    }

    const attachment = await this.attachmentModel.findById(attachmentId);
    if (!attachment) {
      return Response.error(
        'Không tìm thấy attachment',
        404,
        'ATTACHMENT_NOT_FOUND',
      );
    }

    if (attachment.kind !== 'audio') {
      return Response.error(
        'Attachment không phải audio',
        400,
        'NOT_AUDIO_ATTACHMENT',
      );
    }

    if (
      attachment.contextId &&
      attachment.contextId.toString() !== messageId
    ) {
      return Response.error(
        'attachment không thuộc message này',
        400,
        'MISMATCHED_MESSAGE',
      );
    }

    // Already transcribed → idempotent return.
    if (typeof attachment.transcript === 'string') {
      return Response.success(
        {
          transcript: attachment.transcript,
          detectedLanguage: language,
          attachmentId,
          messageId,
          cached: true,
        },
        'Đã có bản transcript',
        200,
        'OK',
      );
    }

    if (!attachment.url) {
      return Response.error(
        'Attachment thiếu URL audio',
        400,
        'MISSING_AUDIO_URL',
      );
    }

    let transcript = '';
    let detectedLanguage: string = language;
    try {
      const result = await this.sfuTranscription.transcribeAudioUrl({
        audioUrl: attachment.url,
        mimeType: attachment.mimeType || 'audio/webm',
        sourceLanguage: language,
        userId,
      });
      transcript = result.transcript ?? '';
      detectedLanguage = result.detectedLanguage || language;
    } catch (err) {
      this.logger.error('Lỗi transcribe audio bằng SFU:', (err as Error).message);
      return Response.error(
        'Không thể chuyển giọng nói thành văn bản',
        502,
        'SPEECH_TO_TEXT_FAILED',
      );
    }

    // Persist (even empty transcript so we don't repeatedly hit Whisper for
    // silent audio).
    try {
      await this.attachmentModel.updateOne(
        { _id: attachment._id },
        {
          $set: {
            transcript,
            transcribedAt: new Date(),
          },
        },
      );
    } catch (err) {
      this.logger.error(
        'Không thể lưu transcript vào DB:',
        (err as Error).message,
      );
      // Continue — we still want to return the transcript to the caller
      // so the UI can show it; the next call will simply re-run the STT
      // since the cache field stays null.
    }

    return Response.success(
      {
        transcript,
        detectedLanguage,
        attachmentId,
        messageId,
        cached: false,
      },
      'Chuyển giọng nói thành văn bản thành công',
      200,
      'OK',
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
