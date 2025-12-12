/*
https://docs.nestjs.com/controllers#controllers
*/

import { SERVICES } from '@app/constants';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import {
  ModerationDto,
  SearchMessagesDto,
  SummaryDocumentDto,
  TranslationDto,
} from '@app/dto/ai.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterFile } from '@app/dto';

interface AiGrpcService {
  // Define AI service methods here
  moderation(data: ModerationDto): any;
  searchMessages(data: SearchMessagesDto): any;
  summaryDocument(data: SummaryDocumentDto): any;
  translation(data: TranslationDto): any;
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
    // Tăng timeout lên 2 phút (120000ms) cho moderation
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.moderation,
      body,
      120000, // 2 minutes timeout
    );
  }

  @Get('search-messages')
  async searchMessages(@Query() query: SearchMessagesDto) {
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.searchMessages,
      query,
    );
  }

  @Post('summary-document')
  @UseInterceptors(FileInterceptor('file'))
  async summaryDocument(@UploadedFile() file: MulterFile) {
    console.log('SummaryDocument request:', file);
    // Tăng timeout lên 2 phút (120000ms) cho xử lý document lớn
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.summaryDocument,
      { file },
      120000, // 2 minutes timeout
    );
  }

  @Post('translation')
  async translation(@Body() body: TranslationDto) {
    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.translation,
      body,
      100000, // 1 minute timeout
    );
  }
}
