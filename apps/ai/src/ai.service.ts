import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLog } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    @InjectModel(AIUsageLog.name)
    private readonly logModel: Model<AIUsageLog>,
  ) {}

  async checkMessage(text: string, userId: string, contextId?: string) {
    const start = Date.now();
    const result = await this.googleProvider.moderate(text);
    const latency = Date.now() - start;

    // Bắt đàu tính token
    const tokenEstimate = Math.ceil(text.length / 4);
    const costUsd = (tokenEstimate / 1000) * 0.000125; // Gemini Flash
    // tạo log để tính chi phí
    await this.logModel.create({
      service: 'moderation',
      provider: result.provider,
      model: result.model,
      userId,
      contextType: 'message',
      contextId,
      input: { text },
      output: {
        verdict: result.verdict,
        categories: result.categories,
        scores: result.scores,
      },
      metadata: { rawResponse: result.rawResponse },
      tokenInput: tokenEstimate,
      latencyMs: latency,
      costUsd,
      status: result.error ? 'error' : 'success',
      error: result.error,
    });

    return result;
  }
}
