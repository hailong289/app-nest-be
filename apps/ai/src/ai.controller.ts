import { Body, Controller } from '@nestjs/common';
import { AIService } from './ai.service';
import { GrpcMethod } from '@nestjs/microservices';

@Controller()
export class AIController {
  constructor(private readonly service: AIService) {}

  @GrpcMethod('AIService', 'Moderation')
  async moderation(data: { text: string; userId: string }) {
    console.log('AI Moderation called with data:', data);
    const result = await this.service.checkMessage(data.text, data.userId);
    
    return {
      message: 'Moderation completed successfully',
      statusCode: 200,
      reasonStatusCode: 'SUCCESS',
      metadata: JSON.stringify(result)
    };
  }
}
