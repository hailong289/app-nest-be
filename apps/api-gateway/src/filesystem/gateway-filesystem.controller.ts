import { Body, Controller, Get, Inject, OnModuleInit, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { ClientKafka } from "@nestjs/microservices";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";


@Controller()
export class GatewayFilesystemController implements OnModuleInit {
    constructor(
        @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientKafka,
        private readonly gatewayService: GatewayService,
    ) {}

    async onModuleInit() {
        this.filesystemClient.subscribeToResponseOf('upload_single_file');
        this.filesystemClient.subscribeToResponseOf('upload_multiple_files');
        this.filesystemClient.subscribeToResponseOf('delete_file');
        this.filesystemClient.subscribeToResponseOf('get_presigned_url');
        
        try {
            await this.filesystemClient.connect();
        } catch (error) {
            console.error('Filesystem service connection error:', error);
        }
    }

     // Filesystem endpoints
    @Post('filesystem/upload-single')
    @UseInterceptors(FileInterceptor('file'))
    async uploadSingleFile(@UploadedFile() file: any, @Body('folder') folder: string) {
        return await this.gatewayService.dispatchServiceRequest(this.filesystemClient, 'upload_single_file', {
            originalname: file.originalname,
            buffer: file.buffer,
            mimetype: file.mimetype,
            folder: folder || 'uploads',
        });
    }

    @Post('filesystem/upload-multiple')
    @UseInterceptors(FilesInterceptor('files', 10))
    async uploadMultipleFiles(@UploadedFiles() files: any[], @Body('folder') folder: string) {
        return await this.gatewayService.dispatchServiceRequest(this.filesystemClient, 'upload_multiple_files', {
            files: files.map(file => ({
                buffer: file.buffer,
                originalname: file.originalname,
                mimetype: file.mimetype,
            })),
            folder: folder || 'uploads',
        });
    }

    @Post('filesystem/delete')
    async deleteFile(@Body() data: { fileName: string; folder?: string }) {
        return await this.gatewayService.dispatchServiceRequest(this.filesystemClient, 'delete_file', data);
    }

    @Get('filesystem/presigned-url')
    async getPresignedUrl(@Query('fileName') fileName: string) {
        return await this.gatewayService.dispatchServiceRequest(this.filesystemClient, 'get_presigned_url', { fileName });
    }
}