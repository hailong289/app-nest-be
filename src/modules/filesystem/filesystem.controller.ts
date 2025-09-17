import { Body, Controller, Get, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileSystemService } from "./filesystem.service";
import { File as MulterFile } from "multer";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";

@Controller('filesystem')
export class FileSystemController {
    constructor(private readonly fileSystemService: FileSystemService) { }

    @Post('upload-single-file')
    @UseInterceptors(FileInterceptor('file'))
    uploadSingleFile(@UploadedFile() file: MulterFile, @Body('folder') folder: string) {
        return this.fileSystemService.uploadSingleFile(file, folder);
    }

    @Post('upload-multiple-files')
    @UseInterceptors(FilesInterceptor('files', 10)) // Limit to 10 files
    uploadMultipleFiles(@UploadedFiles() files: MulterFile[], @Body('folder') folder: string) {
        return this.fileSystemService.uploadMultipleFiles(files, folder);
    }

    @Post('delete-file')
    deleteFile(@Body('fileName') fileName: string, @Body('folder') folder: string) {
        return this.fileSystemService.deleteFile(fileName, folder);
    }

    @Get('get-presigned-url')
    getPresignedUrl(@Query('fileName') fileName: string) {
        return this.fileSystemService.getPresignedUrl(fileName);
    }
}