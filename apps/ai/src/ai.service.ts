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

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    private readonly embeddingService: EmbeddingService,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
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
   *   3. Stream the audio bytes from S3 via the public/signed URL
   *      stored on the attachment (reuses `axios.get` like
   *      `downloadFileFromUrl` does for flashcard file_url).
   *   4. Hand the buffer to GoogleModerationProvider.speechToText, which
   *      calls Gemini with `inlineData` and returns
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

    let buffer: Buffer;
    let mimeType = attachment.mimeType || 'audio/webm';
    try {
      const res = await axios.get<ArrayBuffer>(attachment.url, {
        responseType: 'arraybuffer',
        // Audio < 20MB; cap timeout to avoid stuck requests.
        timeout: 60_000,
        maxContentLength: 20 * 1024 * 1024,
      });
      buffer = Buffer.from(res.data);
      const headerType = res.headers?.['content-type'];
      if (typeof headerType === 'string' && headerType.startsWith('audio/')) {
        mimeType = headerType;
      }
    } catch (err) {
      this.logger.error('Lỗi tải audio từ S3:', (err as Error).message);
      return Response.error(
        'Không thể tải audio từ S3',
        502,
        'AUDIO_FETCH_FAILED',
      );
    }

    const result = await this.googleProvider.speechToText(
      buffer,
      mimeType,
      language,
      userId,
    );

    // Provider returned a structured error → bubble it up unchanged.
    const resp = result as {
      statusCode?: number;
      message?: string;
      reasonStatusCode?: string;
      metadata?: { transcript?: string; detectedLanguage?: string };
    };
    if (!resp.metadata || resp.statusCode !== 200) {
      return result;
    }

    const transcript = resp.metadata.transcript ?? '';
    const detectedLanguage = resp.metadata.detectedLanguage ?? language;

    // Persist (even empty transcript so we don't repeatedly hit Gemini for
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

  async transcribeRealtime(
    audioChunk: Buffer,
    mimeType: string,
    language: 'vi' | 'en',
    userId: string,
    speakerName: string,
  ) {
    if (!audioChunk?.length) {
      return Response.error('Audio chunk rỗng', 400, 'EMPTY_AUDIO_CHUNK');
    }

    const result = await this.googleProvider.speechToText(
      audioChunk,
      mimeType || 'audio/webm',
      language || 'vi',
      userId,
    );

    const resp = result as {
      statusCode?: number;
      metadata?: { transcript?: string; detectedLanguage?: string };
    };

    if (!resp.metadata || resp.statusCode !== 200) {
      return result;
    }

    const transcript = resp.metadata.transcript ?? '';

    return Response.success(
      {
        transcript,
        detectedLanguage: resp.metadata.detectedLanguage ?? language,
        speakerName,
        isEmpty: !transcript.trim(),
      },
      'Real-time STT completed',
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
