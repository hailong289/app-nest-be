import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLog } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { Model } from 'mongoose';

@Injectable()
export class AiLogUseService {
  constructor(
    @InjectModel(AIUsageLog.name)
    private readonly aiUsageLogModel: Model<AIUsageLog>,
  ) {}

  async createLogUsage(
    provider: string = 'google',
    model: string = 'gemini-2.5-flash-lite',
    service: string = 'moderation',
    userId: string,
    tokenInput: number,
    tokenOutput: number,
    latencyMs: number,
    costUsd: number,
    status: 'success' | 'error',
    metadata?: any,
  ) {
    try {
      const newAiLog = new this.aiUsageLogModel({
        provider,
        model,
        service,
        userId,
        tokenInput,
        tokenOutput,
        latencyMs,
        costUsd,
        status,
        metadata,
      });
      await newAiLog.save();
      console.log('Create log usage successfully');
    } catch (error) {
      console.error('Error create log usage:', error);
    }
  }

  async getAiLog(aiLog: AIUsageLog) {
    return this.aiUsageLogModel.find(aiLog).sort({ createdAt: -1 }).limit(10);
  }
}
