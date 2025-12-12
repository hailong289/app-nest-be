import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { DocumentsService } from './documents.service';
import type {
  CreateDocDto,
  CreateDocRequest,
  DeleteDocRequest,
  GetDocRequest,
  ListDocsRequest,
  ServiceResponse,
  ShareDocumentRequest,
  UnshareDocumentRequest,
  UpdateDocRequest,
  UpdateTitleRequest,
  UpdateVisibilityRequest,
  DuplicateDocRequest,
} from '@app/dto';
import { DocVisibilityEnum } from 'libs/db/src';

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * =====================================================
   * Create Document - gRPC Method
   * =====================================================
   * Tạo tài liệu mới với snapshot Yjs
   */
  @GrpcMethod('DocumentService', 'CreateDoc')
  async createDoc(request: CreateDocRequest): Promise<ServiceResponse> {
    console.log('🚀 ~ DocumentsController ~ createDoc ~ request:', request);
    try {
      const createDocDto: CreateDocDto = {
        owerId: request.owerId,
        title: request.title,
        roomId: request.roomId,
        visibility:
          (request.visibility as DocVisibilityEnum) ||
          DocVisibilityEnum.private,
        yjsSnapshot: request.yjsSnapshot
          ? Buffer.from(request.yjsSnapshot)
          : null,
        plainText: request.plainText || '',
        attachmentIds: request.attachmentIds || [],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        sharedWith: (request.sharedWith as any) || [],
      };

      const result = await this.documentsService.createDoc(createDocDto);

      return {
        message: 'Tạo tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message: error instanceof Error ? error.message : 'Lỗi tạo tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * Get Document - gRPC Method
   * =====================================================
   * Lấy tài liệu theo ID với kiểm tra quyền truy cập
   */
  @GrpcMethod('DocumentService', 'GetDoc')
  async getDoc(request: GetDocRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.getDoc(
        request.docId,
        request.userId,
      );

      return {
        message: 'Lấy tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code:
          error instanceof Error && error.message.includes('Không tìm') ? 5 : 2,
        message: error instanceof Error ? error.message : 'Lỗi lấy tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * Update Document - gRPC Method
   * =====================================================
   * Cập nhật Yjs snapshot và plain text của tài liệu
   */
  @GrpcMethod('DocumentService', 'UpdateDoc')
  async updateDoc(request: UpdateDocRequest): Promise<ServiceResponse> {
    console.log('🚀 ~ DocumentsController ~ updateDoc ~ request:', request);
    try {
      const result = await this.documentsService.updateDoc(
        request.docId,
        request.userId,
        {
          yjsSnapshot: request.yjsSnapshot,
          plainText: request.plainText,
        },
      );

      return {
        message: 'Cập nhật tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code:
          error instanceof Error && error.message.includes('không có quyền')
            ? 7
            : 2,
        message:
          error instanceof Error ? error.message : 'Lỗi cập nhật tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * Delete Document - gRPC Method
   * =====================================================
   * Xoá tài liệu (chỉ owner được phép)
   */
  @GrpcMethod('DocumentService', 'DeleteDoc')
  async deleteDoc(request: DeleteDocRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.deleteDoc(
        request.docId,
        request.userId,
      );

      return {
        message: 'Xoá tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata,
      };
    } catch (error) {
      throw new RpcException({
        code:
          error instanceof Error && error.message.includes('không có quyền')
            ? 7
            : 2,
        message: error instanceof Error ? error.message : 'Lỗi xoá tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * List Documents - gRPC Method
   * =====================================================
   * Lấy danh sách tài liệu theo phòng
   * (chỉ show tài liệu mà user có quyền truy cập)
   */
  @GrpcMethod('DocumentService', 'ListDocs')
  async listDocs(request: ListDocsRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.listDocs(
        request.userId,
        request.roomId,
      );

      return {
        message: 'Lấy danh sách tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message:
          error instanceof Error ? error.message : 'Lỗi lấy danh sách tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * Share Document - gRPC Method
   * =====================================================
   */
  @GrpcMethod('DocumentService', 'ShareDocument')
  async shareDocument(request: ShareDocumentRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.shareDocument(
        request.docId,
        request.userId,
        request.shareUserId,
        request.role,
      );

      return {
        message: 'Chia sẻ tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message:
          error instanceof Error ? error.message : 'Lỗi chia sẻ tài liệu',
      });
    }
  }

  /**
   * =====================================================
   * Unshare Document - gRPC Method
   * =====================================================
   */
  @GrpcMethod('DocumentService', 'UnshareDocument')
  async unshareDocument(
    request: UnshareDocumentRequest,
  ): Promise<ServiceResponse> {
    try {
      const { docId, userId, shareUserId } = request;
      const result = await this.documentsService.unshareDocument(
        docId,
        userId,
        shareUserId,
      );

      return {
        message: 'Thu hồi chia sẻ tài liệu thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message: error instanceof Error ? error.message : 'Lỗi thu hồi chia sẻ',
      });
    }
  }

  /**
   * =====================================================
   * Update Title - gRPC Method
   * =====================================================
   */
  @GrpcMethod('DocumentService', 'UpdateTitle')
  async updateTitle(request: UpdateTitleRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.updateTitle(
        request.docId,
        request.userId,
        request.title,
      );

      return {
        message: 'Cập nhật tiêu đề thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message:
          error instanceof Error ? error.message : 'Lỗi cập nhật tiêu đề',
      });
    }
  }

  /**
   * =====================================================
   * Update Visibility - gRPC Method
   * =====================================================
   */
  @GrpcMethod('DocumentService', 'UpdateVisibility')
  async updateVisibility(
    request: UpdateVisibilityRequest,
  ): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.updateVisibility(
        request.docId,
        request.userId,
        request.visibility as DocVisibilityEnum,
      );

      return {
        message: 'Cập nhật quyền truy cập thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message:
          error instanceof Error
            ? error.message
            : 'Lỗi cập nhật quyền truy cập',
      });
    }
  }

  /**
   * =====================================================
   * Duplicate Document - gRPC Method
   * =====================================================
   * Tạo bản sao của tài liệu
   */
  @GrpcMethod('DocumentService', 'DuplicateDoc')
  async duplicateDoc(request: DuplicateDocRequest): Promise<ServiceResponse> {
    try {
      const result = await this.documentsService.duplicateDoc(
        request.docId,
        request.userId,
      );

      return {
        message: 'Tạo bản sao thành công',
        statusCode: 200,
        reasonStatusCode: 'OK',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: result?.metadata || result,
      };
    } catch (error) {
      throw new RpcException({
        code: 2,
        message: error instanceof Error ? error.message : 'Lỗi tạo bản sao',
      });
    }
  }
}
