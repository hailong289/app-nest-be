import {
  Body,
  Controller,
  Headers,
  Inject,
  OnModuleInit,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants';
import { GatewayService } from '../gateway/gateway.service';

interface AiInternalGrpcService {
  TranscribeRealtime(data: {
    audioChunk: Buffer;
    mimeType?: string;
    language?: string;
    userId?: string;
    speakerName?: string;
  }): Observable<unknown>;
}

@Controller('internal/ai')
export class GatewayInternalAiController implements OnModuleInit {
  private aiService!: AiInternalGrpcService;

  constructor(
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.aiService =
      this.aiClient.getService<AiInternalGrpcService>('AIService');
  }

  @Post('transcribe-realtime')
  async transcribeRealtime(
    @Body()
    body: {
      audioChunk: string | number[] | { data?: number[] };
      mimeType?: string;
      language?: string;
      userId?: string;
      speakerName?: string;
    },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.aiService.TranscribeRealtime.bind(this.aiService),
      {
        audioChunk: this.toByteBuffer(body.audioChunk),
        mimeType: body.mimeType || 'audio/webm',
        language: body.language || 'vi',
        userId: body.userId || '',
        speakerName: body.speakerName || '',
      },
      60000,
    );
  }

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
    allowedServices: string[] = [],
  ) {
    if (!internalService || !allowedServices.includes(internalService)) {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }

  private toByteBuffer(value: unknown): Buffer {
    if (!value) return Buffer.alloc(0);
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'base64');
    if (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as { data?: unknown }).data)
    ) {
      return Buffer.from((value as { data: number[] }).data);
    }
    return Buffer.alloc(0);
  }
}
