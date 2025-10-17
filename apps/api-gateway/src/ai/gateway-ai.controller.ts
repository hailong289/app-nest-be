/*
https://docs.nestjs.com/controllers#controllers
*/

import { SERVICES } from '@app/constants';
import { Controller, Inject } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';

interface AiService {
  // Define AI service methods here
}

@Controller('ai')
export class GatewayAiController {
  private aiService: AiService;
  constructor(@Inject(SERVICES.AI) private readonly aiClient: ClientGrpc) {}
}
