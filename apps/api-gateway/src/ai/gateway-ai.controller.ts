/*
https://docs.nestjs.com/controllers#controllers
*/

import { SERVICES } from '@app/constants';
import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { ModerationDto } from '@app/dto/ai.dto';
import { Observable } from 'rxjs';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: {
    usr_id: string;
    [key: string]: any;
  };
}

interface AiGrpcService {
  // Define AI service methods here
  moderation(data: ModerationDto): Observable<any>;
  search(data: {
    query: string;
    userId: string;
    limit: number;
    roomId?: string;
  }): Observable<any>;
  suggestReplies(data: {
    contextMessages: string[];
    userId: string;
  }): Observable<any>;
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
      (data) => this.aiService.moderation(data),
      body,
    );
  }

  @Post('suggest-replies')
  async suggestReplies(
    @Body() body: { contextMessages: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      (data) => this.aiService.suggestReplies(data),
      {
        contextMessages: body.contextMessages,
        userId: req.user.usr_id,
      },
    );
  }

  @Post('search')
  async search(
    @Body() body: { query: string; limit?: number; roomId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.gatewayService.dispatchGrpcRequest(
      (data) => this.aiService.search(data),
      {
        query: body.query,
        userId: req.user.usr_id,
        limit: body.limit || 5,
        roomId: body.roomId,
      },
    );
    console.log('🚀 ~ GatewayAiController ~ search ~ result:', result);
    return result;
  }
}
