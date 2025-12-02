// apps/moderation/src/google.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
} from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { Response } from '@app/helpers/response';

@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GoogleModerationProvider.name);

  constructor(private cfg: ConfigService) {
    const client = new GoogleGenerativeAI(
      cfg.get<string>('google.apiKey') || '',
    );
    this.model = client.getGenerativeModel({
      model: cfg.get<string>('google.model') ?? 'gemini-1.5-flash',
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, // Tình dục
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, // Nguy hiểm
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, // Bất hợp pháp
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
      ],
    });
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
      const start = Date.now();
      const response = await this.model.generateContent(text);
      const latencyMs = Date.now() - start;
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
}
