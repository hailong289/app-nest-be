import {
  Body,
  Controller,
  Headers,
  Inject,
  OnModuleInit,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants/services';
import { GatewayService } from '../gateway/gateway.service';

interface ResolveAttachmentForAiRequest {
  attachmentId: string;
  messageId?: string;
  userId?: string;
}

interface SaveAttachmentTranscriptRequest {
  attachmentId: string;
  messageId?: string;
  userId?: string;
  transcript: string;
  detectedLanguage?: string;
}

interface FileSystemService {
  ResolveAttachmentForAi(
    data: ResolveAttachmentForAiRequest,
  ): Observable<unknown>;
  SaveAttachmentTranscript(
    data: SaveAttachmentTranscriptRequest,
  ): Observable<unknown>;
}

@Controller('internal/filesystem')
export class GatewayInternalFilesystemController implements OnModuleInit {
  private filesystemService: FileSystemService;

  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.filesystemService =
      this.filesystemClient.getService<FileSystemService>('FileSystemService');
  }

  @Post('attachments/resolve-for-ai')
  async resolveAttachmentForAi(
    @Body() body: ResolveAttachmentForAiRequest,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertAiInternalRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.ResolveAttachmentForAi.bind(
        this.filesystemService,
      ),
      body,
      30000,
    );
  }

  @Post('attachments/:attachmentId/transcript')
  async saveAttachmentTranscript(
    @Param('attachmentId') attachmentId: string,
    @Body()
    body: Omit<SaveAttachmentTranscriptRequest, 'attachmentId'>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertAiInternalRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.SaveAttachmentTranscript.bind(
        this.filesystemService,
      ),
      {
        ...body,
        attachmentId,
      },
      30000,
    );
  }

  private assertAiInternalRequest(
    internalService?: string,
    internalSecret?: string,
  ) {
    if (internalService !== 'ai') {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
