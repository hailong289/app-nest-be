import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FilesystemController } from './filesystem.controller';
import { FilesystemService } from './filesystem.service';
import s3Config from './config/app/s3.config';
import path from 'path';


@Module({
  imports: [
    ConfigModule.forRoot({
      load: [s3Config],
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/filesystem/.env'),
    }),
  ],
  controllers: [FilesystemController],
  providers: [FilesystemService],
})
export class AppModule {}