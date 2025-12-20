import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload, EventPattern } from '@nestjs/microservices';
import { FilesystemService } from './filesystem.service';
import { Response } from '@app/helpers/response';
import {
  MultipleFilesUploadDto,
  SingleFileUploadDto,
  uploadSingleFileByUserDTo,
  UploadMultipleFilesByUserDto,
  GetAttachmentsDto,
  KafkaEvent,
} from '@app/dto';

@Controller()
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  @EventPattern(KafkaEvent.processLink)
  async handleProcessLink(
    @Payload()
    data: {
      content: string;
      userId: string;
      roomId: string;
      messageId: string;
    },
  ) {
    console.log('create link');
    await this.filesystemService.processLinks(
      data.content,
      data.userId,
      data.roomId,
      data.messageId,
    );
  }

  @GrpcMethod('FileSystemService', 'UploadSingleFile')
  async uploadSingleFile(@Payload() data: SingleFileUploadDto) {
    try {
      const dataFile = data.file;
      const file = {
        buffer: Buffer.isBuffer(dataFile.buffer)
          ? dataFile.buffer
          : Buffer.from(dataFile.buffer),
        originalname: dataFile.originalname,
        mimetype: dataFile.mimetype,
        size: 0,
        fieldname: '',
        encoding: '7bit',
      };
      return await this.filesystemService.uploadSingleFile(
        file as any,
        data.folder || 'uploads',
      );
    } catch (error) {
      console.error('Upload single file error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return Response.error(
        'Tải hình ảnh thất bại',
        400,
        'ERROR_FILESYSTEM',
        errorMessage,
      );
    }
  }

  @GrpcMethod('FileSystemService', 'UploadMultipleFiles')
  async uploadMultipleFiles(@Payload() data: MultipleFilesUploadDto) {
    const files = data.files.map((fileData) => ({
      buffer: Buffer.from(fileData.buffer),
      originalname: fileData.originalname,
      mimetype: fileData.mimetype,
    })) as any[];
    return await this.filesystemService.uploadMultipleFiles(
      files,
      data.folder || 'uploads',
    );
  }

  @GrpcMethod('FileSystemService', 'DeleteFile')
  async deleteFile(@Payload() data: { fileName: string; folder?: string }) {
    try {
      if (!data || !data.fileName) {
        return { success: false, message: 'File name is required' };
      }
      return await this.filesystemService.deleteFile(
        data.fileName,
        data.folder || 'uploads',
      );
    } catch (error) {
      return Response.error(
        'Xóa file thất bại',
        400,
        'ERROR_FILESYSTEM',
        error,
      );
    }
  }

  @GrpcMethod('FileSystemService', 'GetPresignedUrl')
  async getPresignedUrl(@Payload() data: { fileName: string }) {
    try {
      if (!data || !data.fileName) {
        return { success: false, message: 'File name is required' };
      }
      return await this.filesystemService.getPresignedUrl(data.fileName);
    } catch (error) {
      console.error('Get presigned URL error:', error);
      return { success: false, message: 'Get presigned URL failed' };
    }
  }

  @GrpcMethod('FileSystemService', 'UploadSingleFileForUser')
  async uploadSingleFileForUser(@Payload() data: uploadSingleFileByUserDTo) {
    console.log(
      '🚀 ~ FilesystemController ~ uploadSingleFileForUser ~ data:',
      data,
    );
    try {
      const result = await this.filesystemService.uploadSingleFileByUser(data);

      return result;
    } catch (error) {
      console.error('❌ Upload single file by user error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return Response.error(
        'Tải file thất bại',
        400,
        'ERROR_FILESYSTEM',
        errorMessage,
      );
    }
  }

  @GrpcMethod('FileSystemService', 'UploadMultipleFilesForUser')
  async uploadMultipleFilesForUser(
    @Payload() data: UploadMultipleFilesByUserDto,
  ) {
    try {
      return await this.filesystemService.uploadMultipleFilesByUser(data);
    } catch (error) {
      console.error('❌ Upload multiple files by user error:', error);
      return Response.error(
        'Tải nhiều file thất bại',
        400,
        'ERROR_FILESYSTEM',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  @GrpcMethod('FileSystemService', 'GetAttachments')
  async getAttachments(@Payload() data: GetAttachmentsDto) {
    try {
      return await this.filesystemService.getAttachments(data);
    } catch (error) {
      console.error('❌ Get attachments error:', error);
      return Response.error(
        'Lấy danh sách file thất bại',
        400,
        'ERROR_FILESYSTEM',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
