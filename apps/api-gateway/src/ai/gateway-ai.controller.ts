/*
https://docs.nestjs.com/controllers#controllers
*/

import { SERVICES } from '@app/constants';
import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { ModerationDto, SearchMessagesDto } from '@app/dto/ai.dto';

interface AiGrpcService {
  // Define AI service methods here
  moderation(data: ModerationDto): any;
  searchMessages(data: SearchMessagesDto): any;
}

@Controller('ai')
export class GatewayAiController {
  private aiService: AiGrpcService;
  constructor(
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.aiService = this.aiClient.getService<AiGrpcService>('AIService');
  }

  @Post('moderation')
  async moderation(@Body() body: ModerationDto) {
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.moderation,
      body,
    );
  }

  @Get('search-messages')
  async searchMessages(@Query() query: SearchMessagesDto) {
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.searchMessages,
      query,
    );
  }
}
