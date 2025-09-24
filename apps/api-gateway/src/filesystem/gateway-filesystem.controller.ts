import { Body, Controller, Get, Inject, OnModuleInit, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { ClientKafka } from "@nestjs/microservices";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { firstValueFrom } from "rxjs";


@Controller()
export class GatewayFilesystemController implements OnModuleInit {
    constructor(
        @Inject('FILESYSTEM_SERVICE') private readonly filesystemClient: ClientKafka
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
        try {
            const fileData = {
                originalname: file.originalname,
                buffer: file.buffer,
                mimetype: file.mimetype,
                folder: folder || 'uploads',
            };
            return await firstValueFrom(this.filesystemClient.send('upload_single_file', fileData));
        } catch (error) {
            console.error('Upload single file error:', error);
            return { success: false, message: 'Filesystem service unavailable' };
        }
    }

    @Post('filesystem/upload-multiple')
    @UseInterceptors(FilesInterceptor('files', 10))
    async uploadMultipleFiles(@UploadedFiles() files: any[], @Body('folder') folder: string) {
        try {
            const filesData = {
                files: files.map(file => ({
                    buffer: file.buffer,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                })),
                folder: folder || 'uploads',
            };
            return await firstValueFrom(this.filesystemClient.send('upload_multiple_files', filesData));
        } catch (error) {
            console.error('Upload multiple files error:', error);
            return { success: false, message: 'Filesystem service unavailable' };
        }
    }

    @Post('filesystem/delete')
    async deleteFile(@Body() data: { fileName: string; folder?: string }) {
        try {
            return await firstValueFrom(this.filesystemClient.send('delete_file', data));
        } catch (error) {
            console.error('Delete file error:', error);
            return { success: false, message: 'Filesystem service unavailable' };
        }
    }

    @Get('filesystem/presigned-url')
    async getPresignedUrl(@Query('fileName') fileName: string) {
        try {
            return await firstValueFrom(this.filesystemClient.send('get_presigned_url', { fileName }));
        } catch (error) {
            console.error('Get presigned URL error:', error);
            return { success: false, message: 'Filesystem service unavailable' };
        }
    }
}