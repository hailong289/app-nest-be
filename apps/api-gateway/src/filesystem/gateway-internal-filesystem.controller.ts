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
  HydrateAttachments(data: { attachmentIds: string[] }): Observable<unknown>;
  ResolveAttachmentForAi(
    data: ResolveAttachmentForAiRequest,
  ): Observable<unknown>;
  SaveAttachmentTranscript(
    data: SaveAttachmentTranscriptRequest,
  ): Observable<unknown>;
}

interface DocumentService {
  GetDoc(data: { docId: string; userId?: string }): Observable<unknown>;
  UpdateDoc(data: {
    docId: string;
    userId?: string;
    yjsSnapshot?: unknown;
    plainText?: string;
  }): Observable<unknown>;
  HydrateDocuments(data: {
    documentIds: string[];
    actorUserId?: string;
  }): Observable<unknown>;
}

@Controller('internal/filesystem')
export class GatewayInternalFilesystemController implements OnModuleInit {
  private filesystemService: FileSystemService;
  private documentService: DocumentService;

  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.filesystemService =
      this.filesystemClient.getService<FileSystemService>('FileSystemService');
    this.documentService =
      this.filesystemClient.getService<DocumentService>('DocumentService');
  }

  @Post('attachments/hydrate')
  async hydrateAttachments(
    @Body() body: { attachmentIds: string[] },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['chat']);

    return this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.HydrateAttachments.bind(this.filesystemService),
      { attachmentIds: body.attachmentIds || [] },
      30000,
    );
  }

  @Post('documents/hydrate')
  async hydrateDocuments(
    @Body() body: { documentIds: string[]; actorUserId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['chat']);

    return this.gatewayService.dispatchGrpcRequest(
      this.documentService.HydrateDocuments.bind(this.documentService),
      {
        documentIds: body.documentIds || [],
        actorUserId: body.actorUserId || '',
      },
      30000,
    );
  }

  @Post('documents/:docId/open')
  async openDocument(
    @Param('docId') docId: string,
    @Body() body: { userId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.documentService.GetDoc.bind(this.documentService),
      {
        docId,
        userId: body.userId || '',
      },
      20000,
    );
  }

  @Post('documents/:docId/update')
  async updateDocument(
    @Param('docId') docId: string,
    @Body()
    body: {
      userId?: string;
      yjsSnapshot?: unknown;
      plainText?: string;
    },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.documentService.UpdateDoc.bind(this.documentService),
      {
        docId,
        userId: body.userId || '',
        yjsSnapshot: this.toByteBuffer(body.yjsSnapshot),
        plainText: body.plainText || '',
      },
      20000,
    );
  }

  @Post('attachments/resolve-for-ai')
  async resolveAttachmentForAi(
    @Body() body: ResolveAttachmentForAiRequest,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['ai']);

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
    this.assertInternalRequest(internalService, internalSecret, ['ai']);

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

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
    allowedServices: string[] = ['ai'],
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

  private toByteBuffer(value: unknown): Buffer | undefined {
    if (!value) return undefined;
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
    return undefined;
  }
}
