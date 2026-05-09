// apps/moderation/src/google.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  type GenerateContentRequest,
  type Part,
} from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { Response } from '@app/helpers/response';
import type { MulterFile } from '@app/dto';
import {
  generateFlashcardPrompt,
  generateQuizzPrompt,
  speechToTextPrompt,
  suggestPrompt,
  summaryDocumentPrompt,
  translationPrompt,
} from './prompt/ai.prompt';
import { AiLogUseService } from './ai-log-use.service';
@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  /**
   * Separate model instance reserved for multimodal audio input (STT).
   * Not all Gemini variants accept `inlineData` audio:
   *   - gemini-2.5-flash-lite (default text model) often returns a misleading
   *     `API_KEY_INVALID` when given audio bytes — the key is fine, the
   *     model just can't process the request.
   *   - gemini-2.5-flash / gemini-2.0-flash both accept audio.
   * Override via env `GOOGLE_AUDIO_MODEL`; fall back to `gemini-2.5-flash`.
   */
  private readonly audioModel: GenerativeModel;
  private readonly audioModelName: string;
  private readonly logger = new Logger(GoogleModerationProvider.name);

  constructor(
    private cfg: ConfigService,
    private aiLogUseService: AiLogUseService,
  ) {
    const apiKey = this.cfg.get<string>('google.apiKey') || '';
    console.log(
      '🚀 ~ GoogleModerationProvider ~ constructor ~ apiKey:',
      apiKey,
    );
    const client = new GoogleGenerativeAI(apiKey);
    this.model = client.getGenerativeModel({
      model: this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite',
    });
    this.audioModelName =
      this.cfg.get<string>('google.audioModel') || 'gemini-2.5-flash';
    this.audioModel = client.getGenerativeModel({ model: this.audioModelName });
  }

  async generateContent(
    contents: GenerateContentRequest | string | Array<string | Part>,
    userId: string,
    service: string,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    try {
      const result = await this.model.generateContent(contents);
      const latencyMs = Date.now() - start;
      const jsonString = result.response.text() || '{}';
      const parsedResult = this.safeParseJson<Record<string, unknown>>(
        jsonString,
        {},
      );
      const tokenInput = result.response.usageMetadata?.promptTokenCount || 0;
      const tokenOutput =
        result.response.usageMetadata?.candidatesTokenCount || 0;
      // Calculate cost manually based on token counts (pricing: input $0.075/1M tokens, output $0.30/1M tokens for gemini-2.5-flash-lite)
      const costUsd =
        tokenInput && tokenOutput
          ? (tokenInput / 1_000_000) * 0.075 + (tokenOutput / 1_000_000) * 0.3
          : 0;
      await this.aiLogUseService.createLogUsage(
        'google',
        'gemini-2.5-flash-lite',
        service,
        userId,
        tokenInput,
        tokenOutput,
        latencyMs,
        costUsd,
        'success',
        parsedResult,
      );
      return parsedResult;
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      await this.aiLogUseService.createLogUsage(
        'google',
        'gemini-2.5-flash-lite',
        service,
        userId,
        0,
        0,
        latencyMs,
        0,
        'error',
        err,
      );
      throw err;
    }
  }

  /**
   * Safely parse JSON without throwing; returns fallback on error.
   */
  private safeParseJson<T extends Record<string, unknown>>(
    text: string,
    fallback: T,
  ): T {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
      return fallback;
    } catch (error) {
      this.logger.warn(`JSON parse failed: ${(error as Error).message}`);
      return fallback;
    }
  }

  async moderate(text: string) {
    if (!text || text.length > 10000) {
      return {
        provider: 'google',
        verdict: 'review',
        error: 'Văn bản không hợp lệ',
        categories: [],
      };
    }

    try {
      const response = await this.generateContent(
        {
          contents: [{ role: 'user', parts: [{ text: text }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'moderation',
      );

      return Response.success(
        response,
        'Moderation completed successfully',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi moderation:', (err as Error).message);
      return Response.error('Lỗi xử lý', 400, 'Bad input');
    }
  }

  async suggestReplies(messages: string[]) {
    try {
      if (!messages || messages.length === 0)
        return { suggestions: [], emojis: [], gif_keywords: [] };

      // 2. Prompt định hướng rõ ràng hơn
      const prompt = suggestPrompt(messages);

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });
      const responseText = result.response.text() || '{}';
      const parsedData = this.safeParseJson<{
        suggestions?: unknown;
        emojis?: unknown;
        gif_keywords?: unknown;
      }>(responseText, {});

      const suggestions = Array.isArray(parsedData.suggestions)
        ? (parsedData.suggestions as string[])
        : [];
      const emojis = Array.isArray(parsedData.emojis)
        ? (parsedData.emojis as string[])
        : [];
      const gifKeywords = Array.isArray(parsedData.gif_keywords)
        ? (parsedData.gif_keywords as string[])
        : [];
      return {
        suggestions: suggestions.slice(0, 3),
        emojis: emojis.slice(0, 5),
        gif_keywords: gifKeywords.slice(0, 3),
      };
    } catch (error) {
      const errObj = error as { status?: number };
      if (errObj?.status === 429) {
        this.logger.warn('Gemini API rate limit exceeded.');
        return { suggestions: [], emojis: [], gif_keywords: [] };
      }
      this.logger.error('Failed to suggest replies', error);
      return { suggestions: [], emojis: [], gif_keywords: [] };
    }
  }

  async summaryDocument(file: MulterFile) {
    // 1. Soạn Prompt chi tiết để AI tóm tắt có cấu trúc
    const prompt = summaryDocumentPrompt();

    try {
      // 3. Gọi model với config JSON
      const result = await this.generateContent(
        {
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: file.mimetype,
                    data: Buffer.from(file.buffer).toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'summary-document',
      );

      // 4. Parse kết quả
      const parsedData = result as {
        summary?: unknown;
        title?: unknown;
        key_points?: unknown;
        keyPoints?: unknown;
        language?: unknown;
      };

      // Map data để đảm bảo đúng structure với proto (keyPoints thay vì key_points)
      const metadata = {
        summary:
          typeof parsedData.summary === 'string' ? parsedData.summary : '',
        title: typeof parsedData.title === 'string' ? parsedData.title : '',
        keyPoints: Array.isArray(parsedData.key_points)
          ? (parsedData.key_points as string[])
          : Array.isArray(parsedData.keyPoints)
            ? (parsedData.keyPoints as string[])
            : [],
        language:
          typeof parsedData.language === 'string' ? parsedData.language : '',
      };

      return Response.success(
        metadata, // Trả về object đã structure đúng với proto
        'Tóm tắt tài liệu thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi summary document:', (err as Error).message);
      return Response.error('Lỗi xử lý tóm tắt tài liệu', 400, 'Bad input');
    }
  }

  /**
   * Transcribe an audio buffer to text using Gemini's native multimodal
   * audio support (`inlineData` with audio/* mimeType).
   *
   * Returns the parsed `{ transcript, detectedLanguage }` shape, or a
   * structured Response.error on validation / API failure. The caller
   * (AIService.transcribeAttachment) is responsible for persisting the
   * result onto the Attachment record.
   *
   * @param buffer Raw audio bytes streamed from S3
   * @param mimeType e.g. "audio/webm", "audio/mp4", "audio/wav"
   * @param language Preferred language hint ('vi' | 'en')
   * @param userId User who triggered the action — used for cost tracking
   */
  async speechToText(
    buffer: Buffer,
    mimeType: string,
    language: 'vi' | 'en',
    userId: string,
  ) {
    // Whitelist mimeType — Gemini accepts audio/{wav,mp3,aiff,aac,ogg,flac,webm,mp4,m4a}
    if (!mimeType || !mimeType.startsWith('audio/')) {
      return Response.error(
        'File phải là định dạng audio',
        400,
        'INVALID_MIME_TYPE',
      );
    }

    // Gemini inlineData hard limit ~20MB — guard before sending.
    const MAX_BYTES = 20 * 1024 * 1024;
    if (buffer.length === 0) {
      return Response.error('Audio file rỗng', 400, 'EMPTY_AUDIO');
    }
    if (buffer.length > MAX_BYTES) {
      return Response.error(
        'Audio quá lớn (tối đa 20MB)',
        413,
        'AUDIO_TOO_LARGE',
      );
    }

    const prompt = speechToTextPrompt(language);
    const start = Date.now();

    try {
      // Use the dedicated audio-capable model instead of the default
      // (text) model — `this.generateContent(...)` would route through
      // `this.model` which may not accept `inlineData` audio.
      const result = await this.audioModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          // Lower temperature → more faithful transcription, less paraphrasing.
          temperature: 0.1,
        },
      });
      const latencyMs = Date.now() - start;

      const jsonString = result.response.text() || '{}';
      const parsedResult = this.safeParseJson<Record<string, unknown>>(
        jsonString,
        {},
      );

      // Cost-track via the same logger used by the other features.
      const tokenInput = result.response.usageMetadata?.promptTokenCount || 0;
      const tokenOutput =
        result.response.usageMetadata?.candidatesTokenCount || 0;
      const costUsd =
        tokenInput && tokenOutput
          ? (tokenInput / 1_000_000) * 0.075 + (tokenOutput / 1_000_000) * 0.3
          : 0;
      await this.aiLogUseService.createLogUsage(
        'google',
        this.audioModelName,
        'speech-to-text',
        userId || 'system',
        tokenInput,
        tokenOutput,
        latencyMs,
        costUsd,
        'success',
        parsedResult,
      );

      const parsed = parsedResult as {
        transcript?: unknown;
        detectedLanguage?: unknown;
        detected_language?: unknown;
      };

      const transcript =
        typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '';
      const detectedLanguage =
        typeof parsed.detectedLanguage === 'string'
          ? parsed.detectedLanguage
          : typeof parsed.detected_language === 'string'
            ? parsed.detected_language
            : language;

      return Response.success(
        { transcript, detectedLanguage },
        'Chuyển giọng nói thành văn bản thành công',
        200,
        'OK',
      );
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.logger.error('Lỗi speechToText:', (err as Error).message);
      // Best-effort error log so we still see token-less failure usage.
      try {
        await this.aiLogUseService.createLogUsage(
          'google',
          this.audioModelName,
          'speech-to-text',
          userId || 'system',
          0,
          0,
          latencyMs,
          0,
          'error',
          err,
        );
      } catch {
        // ignore logger failure
      }
      return Response.error(
        'Không thể nhận dạng giọng nói lúc này',
        400,
        'STT_FAILED',
      );
    }
  }

  async translation(text: string, from: string, to: string) {
    const prompt = translationPrompt(text, from, to);

    try {
      const result = await this.generateContent(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'translation',
      );

      // 3. Xử lý kết quả trả về
      const parsedResult = result as { translated_text?: unknown };

      return Response.success(
        typeof parsedResult.translated_text === 'string'
          ? parsedResult.translated_text
          : '',
        'Dịch thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi translation:', (err as Error).message);

      // Fallback: Nếu lỗi JSON parse hoặc lỗi API, trả về nguyên nhân
      return Response.error(
        'Không thể dịch văn bản lúc này',
        400,
        'Bad input or Model Error',
      );
    }
  }

  async generateQuizz(
    file: MulterFile,
    text: string,
    type: 'text' | 'document',
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
  ) {
    const prompt = generateQuizzPrompt(
      text,
      type,
      question_type,
      question_max,
      question_max_points,
    );
    console.log('prompt', prompt);
    try {
      const result = await this.generateContent(
        {
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                type === 'document'
                  ? {
                      inlineData: {
                        mimeType: file.mimetype,
                        data: Buffer.from(file.buffer).toString('base64'),
                      },
                    }
                  : { text: text },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'generate-quizz',
      );

      return Response.success(
        result,
        'Tạo câu hỏi trắc nghiệm thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi generate quizz:', (err as Error).message);
    }
    return Response.error(
      'Không thể tạo câu hỏi trắc nghiệm lúc này',
      400,
      'Bad input',
    );
  }

  async generateFlashcard(
    topic: string,
    type: 'text' | 'document' | 'file_url',
    card_count: number,
    difficulty: number,
    language: string,
    file?: MulterFile,
  ) {
    const prompt = generateFlashcardPrompt(
      topic,
      type,
      card_count,
      difficulty,
      language,
    );

    try {
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [{ text: prompt }];

      if ((type === 'document' || type === 'file_url') && file) {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: Buffer.from(file.buffer).toString('base64'),
          },
        });
      }

      const result = await this.generateContent(
        {
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'generate-flashcard',
      );

      const parsed = result as {
        deck_name?: unknown;
        deck_description?: unknown;
        deck_level?: unknown;
        deck_language?: unknown;
        deck_tags?: unknown;
        flashcards?: unknown;
      };

      const flashcards = Array.isArray(parsed.flashcards)
        ? (parsed.flashcards as Array<{
            card_front: string;
            card_back: string;
            card_hint?: string;
            card_tags?: string[];
            card_difficulty?: number;
          }>)
        : [];

      return Response.success(
        {
          deck_name:
            typeof parsed.deck_name === 'string' ? parsed.deck_name : '',
          deck_description:
            typeof parsed.deck_description === 'string'
              ? parsed.deck_description
              : '',
          deck_level:
            typeof parsed.deck_level === 'string'
              ? parsed.deck_level
              : 'beginner',
          deck_language:
            typeof parsed.deck_language === 'string'
              ? parsed.deck_language
              : language,
          deck_tags: Array.isArray(parsed.deck_tags)
            ? (parsed.deck_tags as string[])
            : [],
          flashcards: flashcards.map((card) => ({
            card_front: card.card_front ?? '',
            card_back: card.card_back ?? '',
            card_hint: card.card_hint ?? '',
            card_tags: Array.isArray(card.card_tags) ? card.card_tags : [],
            card_difficulty: card.card_difficulty ?? difficulty,
          })),
        },
        'Tạo flashcard thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi generate flashcard:', (err as Error).message);
      return Response.error(
        'Không thể tạo flashcard lúc này',
        400,
        'Bad input',
      );
    }
  }
}
