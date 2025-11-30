import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AIUsageLog } from 'libs/db/src/mongo/model/AIUsageLogs.model';
import { GoogleModerationProvider } from './google.provider';
import { Model } from 'mongoose';
import { Response } from '@app/helpers/response';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    // @InjectModel(AIUsageLog.name)
    // private readonly logModel: Model<AIUsageLog>,
  ) {}

  async checkMessage(text: string, userId: string, contextId?: string) {
    const result = await this.googleProvider.moderate(text);
    return result;
  }
}
