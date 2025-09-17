import { Module } from "@nestjs/common";
import { FileSystemController } from "./filesystem.controller";
import { FileSystemService } from "./filesystem.service";

@Module({
    imports: [],
    controllers: [FileSystemController],
    providers: [FileSystemService],
    exports: [],
})
export class FileSystemModule { }