// apps/moderation/src/google.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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
@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GoogleModerationProvider.name);

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
    contents: any,
    userId: string,
    service: string,
  ): Promise<any> {
    const start = Date.now();
    try {
      const result = await this.model.generateContent(contents);
      const latencyMs = Date.now() - start;
      const jsonString = result.response.text();
      const parsedResult = JSON.parse(jsonString);
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
      this.logger.error('Lỗi moderation:', err.message);
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
      const responseText = result.response.text();
      // 3. Parse JSON an toàn
      let parsedData: {
        suggestions: string[];
        emojis: string[];
        gif_keywords: string[];
      } = { suggestions: [], emojis: [], gif_keywords: [] };
      try {
        parsedData = JSON.parse(responseText) as {
          suggestions: string[];
          emojis: string[];
          gif_keywords: string[];
        };
      } catch (e) {
        console.warn('Lỗi parse JSON', e);
      }
      return {
        suggestions: Array.isArray(parsedData.suggestions)
          ? parsedData.suggestions.slice(0, 3)
          : [],
        emojis: Array.isArray(parsedData.emojis)
          ? parsedData.emojis.slice(0, 5)
          : [],
        gif_keywords: Array.isArray(parsedData.gif_keywords)
          ? parsedData.gif_keywords.slice(0, 3)
          : [],
      };
    } catch (error: any) {
      if (error?.status === 429) {
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
          role: 'user',
          parts: [
            { text: prompt }, // Gửi prompt hướng dẫn
            {
              inlineData: {
                mimeType: file.mimetype,
                data: Buffer.from(file.buffer).toString('base64'), // Gửi file binary
              },
            },
          ],
        },
        'system',
        'summary-document',
      );

      // 4. Parse kết quả
      const parsedData = result;

      // Map data để đảm bảo đúng structure với proto (keyPoints thay vì key_points)
      const metadata = {
        summary: parsedData.summary || '',
        title: parsedData.title || '',
        keyPoints: parsedData.key_points || parsedData.keyPoints || [],
        language: parsedData.language || '',
      };

      return Response.success(
        metadata, // Trả về object đã structure đúng với proto
        'Tóm tắt tài liệu thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi summary document:', err.message);
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
      const parsedResult = result;

      return Response.success(
        parsedResult.translated_text,
        'Dịch thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi translation:', err.message);

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
  ) {
    const prompt = generateQuizzPrompt(text, type);

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

      const parsedResult = result;

      return Response.success(
        parsedResult,
        'Tạo câu hỏi trắc nghiệm thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi generate quizz:', err.message);
    }
    return Response.error(
      'Không thể tạo câu hỏi trắc nghiệm lúc này',
      400,
      'Bad input',
    );
  }
}
