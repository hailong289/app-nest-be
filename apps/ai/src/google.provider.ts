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
import { Observable } from 'rxjs';
import {
  generateFlashcardPrompt,
  generateQuizzPrompt,
  speechToTextPrompt,
  suggestPrompt,
  summaryDocumentPrompt,
  translationPrompt,
} from './prompt/ai.prompt';
import { AiLogUseService } from './ai-log-use.service';

const AI_MODELS_CONFIG = {
  // Dòng Gemini 3.1 Pro: Giá thay đổi theo ngưỡng 200k tokens
  'gemini-3.1-pro': {
    tiered: true,
    tiers: [
      { max: 200000, input: 2.0, output: 12.0 },
      { max: Infinity, input: 4.0, output: 18.0 },
    ],
  },

  // Dòng Gemini 2.5 Pro: Ngưỡng 200k tokens
  'gemini-2.5-pro': {
    tiered: true,
    tiers: [
      { max: 200000, input: 1.25, output: 10.0 },
      { max: Infinity, input: 2.5, output: 15.0 },
    ],
  },

  // Dòng Gemini 2.5 Flash: Giá cố định (Flat rate)
  'gemini-2.5-flash': {
    tiered: false,
    input: 0.3,
    output: 2.5,
    audioInput: 1.0, // Giá riêng cho audio input
  },

  // Dòng Gemini 2.5 Flash-Lite (Siêu rẻ theo data gửi)
  'gemini-2.5-flash-lite': {
    tiered: false,
    input: 0.1,
    output: 0.4,
    audioInput: 0.3,
  },

  // Dòng Gemini 2.0 Flash (Bản cũ nhưng vẫn được dùng nhiều)
  'gemini-2.0-flash': {
    tiered: false,
    input: 0.1,
    output: 0.4,
  },
};

@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  private readonly client: GoogleGenerativeAI;
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

    this.client = new GoogleGenerativeAI(
      this.cfg.get<string>('google.apiKey') || '',
    );
    this.model = this.client.getGenerativeModel({
      model: this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite',
    });
    this.audioModelName =
      this.cfg.get<string>('google.audioModel') || 'gemini-2.5-flash';
    this.audioModel = this.client.getGenerativeModel({ model: this.audioModelName });
  }

  /**
   * Lấy GenerativeModel theo tên model chỉ định, hoặc dùng model mặc định.
   */
  private getModel(modelName: string): GenerativeModel {
    const defaultModel =
      this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite';
    if (modelName && modelName !== defaultModel) {
      return this.client.getGenerativeModel({ model: modelName });
    }
    return this.model;
  }

  /**
   * Hàm tính toán chi phí linh hoạt
   * @param {Object} usage - Metadata từ API trả về
   * @param {string} modelName - Tên model (ví dụ: 'gemini-3.1-pro')
   * @param {boolean} isAudio - (Optional) Nếu input là audio thì dùng giá audio
   */
  async calculateAicost(usage, modelName, isAudio = false) {
    const config = AI_MODELS_CONFIG[modelName];
    if (!config || !usage) return 0;

    const promptTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    let inputRate, outputRate;

    if (config.tiered) {
      const tier = config.tiers.find((t) => promptTokens <= t.max);
      inputRate = tier.input;
      outputRate = tier.output;
    } else {
      inputRate =
        isAudio && config.audioInput ? config.audioInput : config.input;
      outputRate = config.output;
    }

    const cost =
      (promptTokens / 1_000_000) * inputRate +
      (outputTokens / 1_000_000) * outputRate;
    return cost;
  }

  async generateContent(
    contents: GenerateContentRequest | string | Array<string | Part>,
    userId: string,
    service: string,
    model?: string | null,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const defaultModel =
      this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite';
    const modelName = model || defaultModel;
    const activeModel = this.getModel(modelName);
    try {
      const result = await activeModel.generateContent(contents);
      const latencyMs = Date.now() - start;
      const jsonString = result.response.text() || '{}';
      const parsedResult = this.safeParseJson<Record<string, unknown>>(
        jsonString,
        {},
      );
      const tokenInput = result.response.usageMetadata?.promptTokenCount || 0;
      const tokenOutput =
        result.response.usageMetadata?.candidatesTokenCount || 0;
      const costUsd = await this.calculateAicost(
        result.response.usageMetadata,
        modelName,
      );
      await this.aiLogUseService.createLogUsage(
        'google',
        modelName,
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
        modelName,
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

  generateContentStreamObservable(
    contents: GenerateContentRequest | string | Array<string | Part>,
    userId: string,
    service: string,
    model?: string | null,
  ): Observable<string> {
    const start = Date.now();
    const defaultModel =
      this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite';
    const modelName = model || defaultModel;
    const activeModel = this.getModel(modelName);

    return new Observable<string>((subscriber) => {
      let fullText = '';
      activeModel
        .generateContentStream(contents)
        .then(async (result) => {
          try {
            for await (const chunk of result.stream) {
              const chunkText = this.extractGeminiText(chunk);
              fullText += chunkText;
              if (chunkText) {
                subscriber.next(chunkText);
              }
            }

            const response = await result.response;
            // Some JSON responses (especially with responseMimeType=application/json)
            // may not provide non-empty incremental chunks. In that case, emit the
            // finalized text once so SSE clients still receive data.
            const responseText = this.extractGeminiText(response);
            if (!fullText.trim() && responseText.trim()) {
              fullText = responseText;
              subscriber.next(responseText);
            }
            const latencyMs = Date.now() - start;
            const parsedResult = this.safeParseJson<Record<string, unknown>>(
              fullText,
              {},
            );
            const tokenInput = response.usageMetadata?.promptTokenCount || 0;
            const tokenOutput =
              response.usageMetadata?.candidatesTokenCount || 0;
            const costUsd = await this.calculateAicost(
              response.usageMetadata,
              modelName,
            );

            this.aiLogUseService.createLogUsage(
              'google',
              modelName,
              service,
              userId,
              tokenInput,
              tokenOutput,
              latencyMs,
              costUsd,
              'success',
              parsedResult,
            );

            subscriber.complete();
          } catch (err) {
            subscriber.error(err);
          }
        })
        .catch((err) => {
          const latencyMs = Date.now() - start;
          this.aiLogUseService.createLogUsage(
            'google',
            modelName,
            service,
            userId,
            0,
            0,
            latencyMs,
            0,
            'error',
            err,
          );
          subscriber.error(err);
        });
    });
  }

  /**
   * Gemini SDK can return empty `text()` for streaming JSON chunks in some
   * cases. This helper falls back to reading candidates/parts text.
   */
  private extractGeminiText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';

    const anyPayload = payload as {
      text?: () => string;
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    try {
      const fromTextFn =
        typeof anyPayload.text === 'function' ? anyPayload.text() : '';
      if (fromTextFn && fromTextFn.trim()) return fromTextFn;
    } catch {
      // Ignore and fallback to candidates text.
    }

    const parts = anyPayload.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';

    return parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
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

  async summaryDocument(file?: MulterFile, model?: string | null) {
    if (!file) {
      return Response.error(
        'File không hợp lệ hoặc không được cung cấp',
        400,
        'Bad input',
      );
    }

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
        model,
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

  async translation(text: string, from: string, to: string, model?: string | null) {
    const prompt = translationPrompt(text, from, to);

    try {
      const result = await this.generateContent(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'translation',
        model,
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
    file: MulterFile | undefined,
    text: string,
    type: 'text' | 'document',
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
    model?: string | null,
  ) {
    if (type === 'document' && !file) {
      return Response.error(
        'Thiếu file tài liệu cho chế độ document',
        400,
        'Bad input',
      );
    }

    const prompt = generateQuizzPrompt(
      text,
      type,
      question_type,
      question_max,
      question_max_points,
    );
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];
    if (type === 'document' && file) {
      parts.push({
        inlineData: {
          mimeType: file.mimetype,
          data: Buffer.from(file.buffer).toString('base64'),
        },
      });
    } else {
      parts.push({ text });
    }
    console.log('prompt', prompt);
    try {
      const result = await this.generateContent(
        {
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        },
        'system',
        'generate-quizz',
        model,
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
    model?: string | null,
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
        model,
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

  generateFlashcardStream(
    topic: string,
    type: 'text' | 'document' | 'file_url',
    card_count: number,
    difficulty: number,
    language: string,
    file?: MulterFile,
    model?: string | null,
  ): Observable<string> {
    const prompt = generateFlashcardPrompt(
      topic,
      type,
      card_count,
      difficulty,
      language,
    );

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

    return this.generateContentStreamObservable(
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      'system',
      'generate-flashcard',
      model,
    );
  }

  generateQuizzStream(
    file: MulterFile | undefined,
    text: string,
    type: 'text' | 'document',
    question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text',
    question_max: number,
    question_max_points: number,
    model?: string | null,
  ): Observable<string> {
    if (type === 'document' && !file) {
      return new Observable<string>((subscriber) => {
        subscriber.error(
          new Error('Thiếu file tài liệu cho chế độ document'),
        );
      });
    }

    const prompt = generateQuizzPrompt(
      text,
      type,
      question_type,
      question_max,
      question_max_points,
    );
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];
    if (type === 'document' && file) {
      parts.push({
        inlineData: {
          mimeType: file.mimetype,
          data: Buffer.from(file.buffer).toString('base64'),
        },
      });
    } else {
      parts.push({ text });
    }

    return this.generateContentStreamObservable(
      {
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      },
      'system',
      'generate-quizz',
      model,
    );
  }

  summaryDocumentStream(
    file?: MulterFile,
    model?: string | null,
  ): Observable<string> {
    const prompt = summaryDocumentPrompt();

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];

    if (file) {
      parts.push({
        inlineData: {
          mimeType: file.mimetype,
          data: Buffer.from(file.buffer).toString('base64'),
        },
      });
    }

    return this.generateContentStreamObservable(
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      'system',
      'summary-document',
      model,
    );
  }
}
