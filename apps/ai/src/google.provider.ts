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
  generateQuizzPrompt,
  suggestPrompt,
  summaryDocumentPrompt,
  translationPrompt,
} from './prompt/ai.prompt';
import { AiLogUseService } from './ai-log-use.service';
import * as mammoth from 'mammoth';
@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GoogleModerationProvider.name);

  private readonly supportedInlineMimeTypes = new Set<string>([
    'application/pdf',
    'text/plain',
    'text/markdown',
  ]);

  constructor(
    private cfg: ConfigService,
    private aiLogUseService: AiLogUseService,
  ) {
    const client = new GoogleGenerativeAI(
      this.cfg.get<string>('google.apiKey') || '',
    );
    this.model = client.getGenerativeModel({
      model: this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite',
    });
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
    const prompt = summaryDocumentPrompt();

    try {
      const parts: Part[] = [{ text: prompt }];

      if (
        file.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'application/msword'
      ) {
        // Extract text from docx and send as plain text
        const docxText = await mammoth.extractRawText({ buffer: file.buffer });
        const textContent = docxText.value || '';
        if (!textContent.trim()) {
          throw new Error('DOCX conversion returned empty text');
        }
        parts.push({ text: textContent });
      } else if (this.supportedInlineMimeTypes.has(file.mimetype)) {
        parts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: Buffer.from(file.buffer).toString('base64'),
          },
        });
      } else {
        // Fallback: send as octet-stream inline
        parts.push({
          inlineData: {
            mimeType: 'application/octet-stream',
            data: Buffer.from(file.buffer).toString('base64'),
          },
        });
      }

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
        'summary-document',
      );

      const parsedData = result as {
        summary?: unknown;
        title?: unknown;
        key_points?: unknown;
        keyPoints?: unknown;
        language?: unknown;
      };

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

      // Proto expects metadata as string; stringify to preserve structure
      return Response.success(
        JSON.stringify(metadata),
        'Tóm tắt tài liệu thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi summary document:', (err as Error).message);
      return Response.error('Lỗi xử lý tóm tắt tài liệu', 400, 'Bad input');
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
}
