import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FilesystemController } from './filesystem.controller';
import { FilesystemService } from './filesystem.service';
import s3Config from './config/app/s3.config';
import path from 'path';
import { mongoConfig, MongodbModule } from 'libs/db/src';
import { DocumentsModule } from './documents/documents.module';
import { kafkaConfig } from 'libs/kafka';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [s3Config, mongoConfig, kafkaConfig],
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        'apps/filesystem/.env.development',
      ),
    }),
    MongodbModule,
    DocumentsModule,
  ],
  controllers: [FilesystemController],
  providers: [FilesystemService],
})
export class AppModule {}
