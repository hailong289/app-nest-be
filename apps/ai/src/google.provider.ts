// apps/moderation/src/google.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
} from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

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
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
      ],
    });
  }

  async moderate(text: string) {
    const start = Date.now();
    try {
      const response = await this.model.generateContent(text);
      const latencyMs = Date.now() - start;

      const safety = response.response.promptFeedback?.safetyRatings ?? [];
      const scores = Object.fromEntries(
        safety.map((r) => [r.category, r.probability ?? 0]),
      );

      const categories = safety
        .filter((r) => {
          const level = (r.probability ?? '').toString().toUpperCase();
          return level === 'MEDIUM' || level === 'HIGH' || level === 'VERY_HIGH';
        })
        .map((r) => r.category);

      return {
        provider: 'google',
        model: this.cfg.get<string>('google.model'),
        scores,
        categories,
        verdict: categories.length ? 'block' : 'allow',
        latencyMs,
        rawResponse: safety,
      };
    } catch (err) {
      this.logger.error('Moderation failed', err);
      return {
        provider: 'google',
        model: this.cfg.get<string>('google.model'),
        verdict: 'review',
        error: err.message,
      };
    }
  }
}
