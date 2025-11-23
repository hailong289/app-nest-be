import { Body, Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod } from '@nestjs/microservices';
import { Response } from '@app/helpers/response';

@Controller()
export class AIController {
  constructor(private readonly service: AIService) {}

  @GrpcMethod('AIService', 'Moderation')
  async moderation(data: { text: string; userId: string }) {
    return await this.service.checkMessage(data.text, data.userId);
  }
}
