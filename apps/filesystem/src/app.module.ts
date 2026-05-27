import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FilesystemController } from './filesystem.controller';
import { FilesystemService } from './filesystem.service';
import s3Config from './config/app/s3.config';
import path from 'path';
import { MongooseModule } from '@nestjs/mongoose';
import { mongoConfig, MongodbModule, attachmentModel } from 'libs/db/src';
import { DocumentsModule } from './documents/documents.module';
import { kafkaConfig } from 'libs/kafka';
import { SharedKafkaClientModule } from 'libs/kafka/kafka-client.module';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { SERVICES } from '@app/constants';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import authConfig from './config/app/auth.config';
import chatConfig from './config/app/chat.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [s3Config, mongoConfig, kafkaConfig, authConfig, chatConfig],
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        'apps/filesystem/.env.development',
      ),
    }),
    MongodbModule,
    // Removed userModel, messagesModel, roomModel — accessed via gRPC
    MongooseModule.forFeature([attachmentModel]),
    DocumentsModule,
    KafkaAdminModule,
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.AI,
      clientId: 'filesystem-ai-client',
      groupId: 'filesystem-ai-group',
    }),
    // gRPC clients for cross-service data access (database isolation)
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat'],
    }),
  ],
  controllers: [FilesystemController],
  providers: [FilesystemService],
})
export class AppModule {}
