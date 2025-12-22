import { SERVICES } from '@app/constants';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../../gateway/gateway.service';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from 'libs/types';

interface DocumentService {
  CreateDoc(data: any): Observable<any>;
  GetDoc(data: any): Observable<any>;
  UpdateDoc(data: any): Observable<any>;
  DeleteDoc(data: any): Observable<any>;
  ListDocs(data: any): Observable<any>;
  ShareDocument(data: any): Observable<any>;
  UnshareDocument(data: any): Observable<any>;
  UpdateTitle(data: any): Observable<any>;
  UpdateVisibility(data: any): Observable<any>;
  DuplicateDoc(data: any): Observable<any>;
}

@Controller('documents')
export class GatewayDocumentController implements OnModuleInit {
  private documentService: DocumentService;

  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.documentService =
      this.filesystemClient.getService<DocumentService>('DocumentService');
  }

  @Post('')
  async createDocument(
    @Body()
    body: {
      title: string;
      roomId?: string;
      visibility?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.CreateDoc.bind(this.documentService),
      {
        owerId: req.user._id,
        title: body.title || 'Untitled Document',
        roomId: body.roomId,
        visibility: body.visibility || 'private',
      },
    );
  }

  /**
   * GET /filesystem/documents - List documents by room
   */
  @Get('')
  async listDocuments(
    @Query('roomId') roomId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.ListDocs.bind(this.documentService),
      {
        userId: req.user._id,
        roomId,
      },
    );
  }

  /**
   * GET /filesystem/documents/:docId - Get single document
   */
  @Get('/:docId')
  async getDocument(
    @Param('docId') docId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.GetDoc.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
      },
    );
  }

  /**
   * PATCH /filesystem/documents/:docId - Update document
   */
  @Patch('/:docId')
  async updateDocument(
    @Param('docId') docId: string,
    @Body()
    body: {
      plainText?: string;
      yjsSnapshot?: Buffer;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.UpdateDoc.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
        yjsSnapshot: body.yjsSnapshot,
        plainText: body.plainText,
      },
    );
  }

  /**
   * DELETE /filesystem/documents/:docId - Delete document
   */
  @Delete('/:docId')
  async deleteDocument(
    @Param('docId') docId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.DeleteDoc.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
      },
    );
  }

  /**
   * POST /filesystem/documents/:docId/share - Share document
   */
  @Post('/:docId/share')
  async shareDocument(
    @Param('docId') docId: string,
    @Body() body: { shareUserId: string; role?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.ShareDocument.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
        shareUserId: body.shareUserId,
        role: body.role || 'editor',
      },
    );
  }

  /**
   * POST /filesystem/documents/:docId/unshare - Unshare document
   */
  @Post('/:docId/unshare')
  async unshareDocument(
    @Param('docId') docId: string,
    @Body() body: { shareUserId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.UnshareDocument.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
        shareUserId: body.shareUserId,
      },
    );
  }

  /**
   * PATCH /filesystem/documents/:docId/title - Update title
   */
  @Patch('/:docId/title')
  async updateTitle(
    @Param('docId') docId: string,
    @Body() body: { title: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.UpdateTitle.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
        title: body.title,
      },
    );
  }

  /**
   * PATCH /filesystem/documents/:docId/visibility - Update visibility
   */
  @Patch('/:docId/visibility')
  async updateVisibility(
    @Param('docId') docId: string,
    @Body() body: { visibility: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.UpdateVisibility.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
        visibility: body.visibility,
      },
    );
  }

  /**
   * POST /filesystem/documents/:docId/duplicate - Duplicate document
   */
  @Post('/:docId/duplicate')
  async duplicateDocument(
    @Param('docId') docId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      this.documentService.DuplicateDoc.bind(this.documentService),
      {
        docId,
        userId: req.user._id,
      },
    );
  }
}
