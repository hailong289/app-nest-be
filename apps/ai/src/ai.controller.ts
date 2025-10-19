import { Body, Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod } from '@nestjs/microservices';

@Controller()
export class AIController {
  constructor(private readonly service: AIService) {}

  @GrpcMethod('AiService', 'moderation')
  async moderation(@Body() body: { text: string; userId: string }) {
    return await this.service.checkMessage(body.text, body.userId);
  }
}
