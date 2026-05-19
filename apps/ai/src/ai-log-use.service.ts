import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLogs } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { KafkaEvent } from '@app/dto/enum.type';
import { Model, PipelineStage } from 'mongoose';

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
  ) { }

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


  /**
   * Lấy báo cáo thống kê AI usage theo các tiêu chí.
   * Dùng aggregation pipeline của MongoDB.
   */
  async getUsageReport(params: {
    service?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    groupBy: 'service' | 'userId' | 'day';
  }) {
    const match: Record<string, unknown> = {};
    if (params.service) match.service = params.service;
    if (params.userId) match.userId = params.userId;
    if (params.from || params.to) {
      match.createdAt = {};
      if (params.from) (match.createdAt as Record<string, unknown>)['$gte'] = params.from;
      if (params.to) (match.createdAt as Record<string, unknown>)['$lte'] = params.to;
    }

    let groupId: {
      _id:
      | string
      | { $dateToString: { format: string; date: string } };
    };
    switch (params.groupBy) {
      case 'userId':
        groupId = { _id: '$userId' };
        break;
      case 'day':
        groupId = {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
        };
        break;
      case 'service':
      default:
        groupId = { _id: '$service' };
        break;
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          ...groupId,
          totalCalls: { $sum: 1 },
          successCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
          },
          errorCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] },
          },
          totalTokenInput: { $sum: { $ifNull: ['$tokenInput', 0] } },
          totalTokenOutput: { $sum: { $ifNull: ['$tokenOutput', 0] } },
          totalCostUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
          avgLatencyMs: { $avg: { $ifNull: ['$latencyMs', 0] } },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          _id: 0,
          group: '$_id',
          totalCalls: 1,
          successCalls: 1,
          errorCalls: 1,
          totalTokenInput: { $round: ['$totalTokenInput', 0] },
          totalTokenOutput: { $round: ['$totalTokenOutput', 0] },
          totalCostUsd: { $round: ['$totalCostUsd', 6] },
          avgLatencyMs: { $round: ['$avgLatencyMs', 0] },
          uniqueUserCount: { $size: '$uniqueUsers' },
        },
      },
      { $sort: { totalCalls: -1 as const } },
    ];


    const results = await this.aiUsageLogModel.aggregate(pipeline).exec();

    return {
      groupBy: params.groupBy,
      total: results.reduce((acc, r) => acc + r.totalCalls, 0),
      items: results,
    };
  }
}
