import { Injectable, Logger } from '@nestjs/common';
import { GoogleModerationProvider } from './google.provider';
import { EmbeddingService } from './embedding.service';
import { MulterFile } from '@app/dto';
import { Response } from '@app/helpers/response';
import axios from 'axios';
import { basename } from 'node:path';
import { GatewayClientService } from './gateway-client.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    private readonly embeddingService: EmbeddingService,
    private readonly gatewayClient: GatewayClientService,
  ) {}

  async checkMessage(text: string, userId: string, contextId?: string) {
    const result = await this.googleProvider.moderate(text, userId);
    return result;
  }

  async suggestReplies(
    messages: string[],
    userId: string,
  ): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }> {
    const result = await this.googleProvider.suggestReplies(messages, userId);
    return result;
  }

  async searchMessages(
    text: string,
    roomId: string,
    limit: number,
    userId?: string,
  ) {
    const result = await this.embeddingService.searchSimilarMessages(
      text,
      roomId,
      limit,
      userId,
    );
    return result;
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

    const result = await this.googleProvider.summaryDocument(
      inputFile,
      model,
      userId,
    );
    return result;
  }

  async translation(
    text: string,
    from: string,
    to: string,
    model?: string | null,
    userId?: string,
  ) {
    const result = await this.googleProvider.translation(
      text,
      from,
      to,
      model,
      userId,
    );
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
   * AI does not query/update Attachments directly. Callers should pass
   * file metadata, or AI resolves/persists through API gateway internal routes.
   */
  async transcribeAttachment(
    attachmentId: string,
    messageId: string,
    language: 'vi' | 'en',
    userId: string,
    fileUrl?: string,
    mimeType?: string,
    cachedTranscript?: string,
  ) {
    if (!attachmentId || !messageId) {
      return Response.error(
        'Thiếu attachmentId hoặc messageId',
        400,
        'BAD_REQUEST',
      );
    }

    if (typeof cachedTranscript === 'string') {
      return Response.success(
        {
          transcript: cachedTranscript,
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

    let resolvedFileUrl = fileUrl;
    let resolvedMimeType = mimeType || 'audio/webm';

    if (!resolvedFileUrl) {
      const resolved = await this.gatewayClient.resolveAttachmentForAi({
        attachmentId,
        messageId,
        userId,
      });

      if (resolved?.statusCode && resolved.statusCode !== 200) {
        return resolved;
      }

      const metadata = resolved?.metadata as
        | {
            fileUrl?: string;
            mimeType?: string;
            kind?: string;
            transcript?: string;
            transcribedAt?: string;
          }
        | undefined;

      if (!metadata) {
        return Response.error(
          'Không thể resolve attachment',
          502,
          'ATTACHMENT_RESOLVE_FAILED',
        );
      }

      if (metadata.kind && metadata.kind !== 'audio') {
        return Response.error(
          'Attachment không phải audio',
          400,
          'NOT_AUDIO_ATTACHMENT',
        );
      }

      if (typeof metadata.transcript === 'string' && metadata.transcribedAt) {
        return Response.success(
          {
            transcript: metadata.transcript,
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

      resolvedFileUrl = metadata.fileUrl;
      resolvedMimeType = metadata.mimeType || resolvedMimeType;
    }

    if (!resolvedFileUrl) {
      return Response.error(
        'Attachment thiếu URL audio',
        400,
        'MISSING_AUDIO_URL',
      );
    }

    let buffer: Buffer;
    try {
      const res = await axios.get<ArrayBuffer>(resolvedFileUrl, {
        responseType: 'arraybuffer',
        // Audio < 20MB; cap timeout to avoid stuck requests.
        timeout: 60_000,
        maxContentLength: 20 * 1024 * 1024,
      });
      buffer = Buffer.from(res.data);
      const headerType = res.headers?.['content-type'];
      if (typeof headerType === 'string' && headerType.startsWith('audio/')) {
        resolvedMimeType = headerType;
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
      resolvedMimeType,
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

    try {
      await this.gatewayClient.persistAttachmentTranscript(attachmentId, {
        messageId,
        userId,
        transcript,
        detectedLanguage,
      });
    } catch (err) {
      this.logger.error(
        'Không thể lưu transcript qua gateway:',
        (err as Error).message,
      );
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
