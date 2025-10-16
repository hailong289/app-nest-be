import { Controller, Inject } from '@nestjs/common';
import { ClientKafka, GrpcMethod, MessagePattern, Payload } from '@nestjs/microservices';
import { FilesystemService } from './filesystem.service';

export interface FileUploadData {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  folder?: string;
}

export interface MultipleFileUploadData {
  files: FileUploadData[];
  folder?: string;
}

@Controller()
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  @GrpcMethod('FilesystemService', 'UploadSingleFile')
  async uploadSingleFile(@Payload() data: FileUploadData) {
    try {
      if (!data || !data.buffer || !data.originalname) {
        return { success: false, message: 'File data is required' };
      }
      const file = {
        buffer: Buffer.from(data.buffer),
        originalname: data.originalname,
        mimetype: data.mimetype,
      } as any;
      return await this.filesystemService.uploadSingleFile(
        file,
        data.folder || 'uploads',
      );
    } catch (error) {
      console.error('Upload single file error:', error);
      return { success: false, message: 'Upload single file failed' };
    }
  }

  @GrpcMethod('FilesystemService', 'UploadMultipleFiles')
  async uploadMultipleFiles(@Payload() data: MultipleFileUploadData) {
    try {
      if (!data || !data.files || data.files.length === 0) {
        return { success: false, message: 'Files data is required' };
      }
      const files = data.files.map((fileData) => ({
        buffer: Buffer.from(fileData.buffer),
        originalname: fileData.originalname,
        mimetype: fileData.mimetype,
      })) as any[];
      return await this.filesystemService.uploadMultipleFiles(
        files,
        data.folder || 'uploads',
      );
    } catch (error) {
      console.error('Upload multiple files error:', error);
      return { success: false, message: 'Upload multiple files failed' };
    }
  }

  @GrpcMethod('FilesystemService', 'DeleteFile')
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
      console.error('Delete file error:', error);
      return { success: false, message: 'Delete file failed' };
    }
  }

  @GrpcMethod('FilesystemService', 'GetPresignedUrl')
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
}
