import { Controller, Get, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileSystemService } from "./filesystem.service";
import { File as MulterFile } from "multer";
import { FileInterceptor } from "@nestjs/platform-express";

@Controller('filesystem')
export class FileSystemController {
    constructor(private readonly fileSystemService: FileSystemService) { }

    @Post('uploadSingleFile')
    @UseInterceptors(FileInterceptor('file'))
    uploadSingleFile(@UploadedFile() file: MulterFile) {
        return this.fileSystemService.uploadSingleFile(file);
    }

    @Get('getPresignedUrl')
    getPresignedUrl(@Query('fileName') fileName: string) {
        return this.fileSystemService.getPresignedUrl(fileName);
    }
}