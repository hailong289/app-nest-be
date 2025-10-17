import {
  Body,
  Controller,
  Get,
  Inject,
  OnModuleInit,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';

interface UploadedFileType {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
}

interface FileSystemService {
  uploadSingleFile(data: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
    folder: string;
  }): any;
  uploadMultipleFiles(data: {
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>;
    folder: string;
  }): any;
  deleteFile(data: { fileName: string; folder?: string }): any;
  getPresignedUrl(data: { fileName: string }): any;
}

@Controller('filesystem')
export class GatewayFilesystemController implements OnModuleInit {
  private filesystemService: FileSystemService;
  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.filesystemService =
      this.filesystemClient.getService<FileSystemService>('FileSystemService');
  }

  // Filesystem endpoints
  @Post('upload-single')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingleFile(
    @UploadedFile() file: UploadedFileType,
    @Body('folder') folder: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.uploadSingleFile,
      {
        originalname: file.originalname,
        buffer: file.buffer,
        mimetype: file.mimetype,
        folder: folder || 'uploads',
      },
    );
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultipleFiles(
    @UploadedFiles() files: UploadedFileType[],
    @Body('folder') folder: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.uploadMultipleFiles,
      {
        files: files.map((file) => ({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        })),
        folder: folder || 'uploads',
      },
    );
  }

  @Post('delete')
  async deleteFile(@Body() data: { fileName: string; folder?: string }) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.deleteFile,
      data,
    );
  }

  @Get('presigned-url')
  async getPresignedUrl(@Query('fileName') fileName: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.getPresignedUrl,
      { fileName },
    );
  }
}
