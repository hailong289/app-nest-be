import { Injectable } from '@nestjs/common';

@Injectable()
export class GatewayService {
  getHealth(): string {
    return 'API Gateway is healthy!';
  }

  getGatewayInfo() {
    return {
      service: 'API Gateway',
      version: '1.0.0',
      description: 'Main entry point for microservices',
      endpoints: {
        auth: ['POST /auth/login', 'POST /auth/register'],
        chat: ['GET /chat/messages', 'POST /chat/send'],
      },
    };
  }
}
