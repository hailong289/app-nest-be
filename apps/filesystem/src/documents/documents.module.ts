import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import {
  Document,
  DocumentSchema,
  Attachment,
  AttachmentSchema,
} from 'libs/db/src';
import { SharedKafkaClientModule } from 'libs/kafka';
import { SERVICES } from '@app/constants';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: Attachment.name, schema: AttachmentSchema },
      // Removed: Room model — room info accessed via gRPC Chat service
    ]),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.AI,
      clientId: 'filesystem-service-ai-client',
      groupId: 'filesystem-service-ai-group',
    }),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'filesystem-service-notification-client',
      groupId: 'filesystem-service-notification-group',
    }),
    // gRPC client to Auth service for user info
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
    // gRPC client to Chat service for room info
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat'],
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
