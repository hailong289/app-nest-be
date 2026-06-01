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
import { GatewayClientService } from '../gateway-client.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: Attachment.name, schema: AttachmentSchema },
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
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, GatewayClientService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
