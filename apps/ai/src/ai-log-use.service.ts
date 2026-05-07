import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLogs } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { KafkaEvent } from '@app/dto/enum.type';
import { Model } from 'mongoose';

export const AI_KAFKA_CLIENT = 'AI_KAFKA_CLIENT';

export interface AiLogUsagePayload {
  provider: string;
  model: string;
  service: string;
  userId: string;
  tokenInput: number;
  tokenOutput: number;
  latencyMs: number;
  costUsd: number;
  status: 'success' | 'error';
  metadata?: any;
}

@Injectable()
export class AiLogUseService {
  private readonly logger = new Logger(AiLogUseService.name);

  constructor(
    @InjectModel(AIUsageLogs.name)
    private readonly aiUsageLogModel: Model<AIUsageLogs>,
    @Inject(AI_KAFKA_CLIENT)
    private readonly kafkaClient: ClientKafka,
  ) {}

  /**
   * Emit log usage event qua Kafka (fire-and-forget, không block luồng chính)
   */
  createLogUsage(
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
    const payload: AiLogUsagePayload = {
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
    };

    // emit không await để không block luồng AI chính
    this.kafkaClient.emit(KafkaEvent.AI_LOG_USAGE, payload);
  }

  /**
   * Được gọi bởi Kafka consumer để ghi DB
   */
  async writeLogToDb(payload: AiLogUsagePayload) {
    try {
      const newAiLog = new this.aiUsageLogModel(payload);
      await newAiLog.save();
      this.logger.log(`AI log saved: ${payload.service} / ${payload.status}`);
    } catch (error) {
      this.logger.error('Error writing AI log to DB:', error);
    }
  }

  async getAiLog(aiLog: AIUsageLogs) {
    return this.aiUsageLogModel.find(aiLog).sort({ createdAt: -1 }).limit(10);
  }
}
