import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  OnModuleInit,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import type { MulterFile } from '@app/dto';
import {
  MultipleFilesUploadDto,
  SingleFileUploadDto,
  UploadSingleFileForUserDto,
  GetAttachmentsDto,
} from '@app/dto';

interface UploadedFileType {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
}

interface FileSystemService {
  uploadSingleFile(data: SingleFileUploadDto): any;
  uploadMultipleFiles(data: MultipleFilesUploadDto): any;
  deleteFile(data: { fileName: string; folder?: string }): any;
  getPresignedUrl(data: { fileName: string }): any;
  UploadSingleFileForUser(data: UploadSingleFileForUserDto): any;
  UploadMultipleFilesForUser(data: any): any;
  getAttachments(data: GetAttachmentsDto): any;
}

@Controller('filesystem')
export class GatewayFilesystemController implements OnModuleInit {
  private filesystemService: FileSystemService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

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
    @UploadedFile() file: MulterFile,
    @Body('folder') folder: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.uploadSingleFile.bind(this.filesystemService),
      {
        file: {
          originalname: file.originalname,
          buffer: file.buffer,
          mimetype: file.mimetype,
        },
        folder: folder || 'uploads',
      },
    );
  }
  @Post('upload-single-user')
  @UseInterceptors(FileInterceptor('file'))
  async UploadFileByUser(
    @UploadedFile() file: MulterFile,
    @Body()
    body: {
      roomId: string;
      id?: string;
      messageId?: string;
    },
    @Req() req: { user?: { _id?: string; usr_id?: string } },
  ) {
    console.log('� Upload request from user:', {
      userId: req.user?._id,
      body,
      fileName: file?.originalname,
    });

    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.UploadSingleFileForUser.bind(
        this.filesystemService,
      ),
      {
        file,
        ...body,
        userId: req.user._id, // ✅ Dùng _id (ObjectId) thay vì usr_id (string)
      },
    );
  }

  @Post('upload-multiple-user')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultipleFilesForUser(
    @UploadedFiles() files: UploadedFileType[],
    @Body()
    body: {
      roomId: string;
      messageId?: string;
    },
    @Req() req: { user?: { _id?: string } },
  ) {
    if (!req.user?._id) {
      throw new NotFoundException('User not authenticated');
    }

    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.UploadMultipleFilesForUser.bind(
        this.filesystemService,
      ),
      {
        files: files.map((file) => ({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        })),
        roomId: body.roomId,
        messageId: body.messageId,
        userId: req.user._id,
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
      this.filesystemService.uploadMultipleFiles.bind(this.filesystemService),
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
      this.filesystemService.deleteFile.bind(this.filesystemService),
      data,
    );
  }

  @Get('presigned-url')
  async getPresignedUrl(@Query('fileName') fileName: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.getPresignedUrl.bind(this.filesystemService),
      { fileName },
    );
  }

  @Get('attachments')
  async getAttachments(@Query() query: GetAttachmentsDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.filesystemService.getAttachments.bind(this.filesystemService),
      query,
    );
  }

  // =====================================================
  // Document API Endpoints
  // =====================================================
}
