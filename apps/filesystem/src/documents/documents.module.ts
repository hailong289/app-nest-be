import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import {
  Document,
  DocumentSchema,
  Attachment,
  AttachmentSchema,
  Room,
  RoomSchema,
} from 'libs/db/src';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: Attachment.name, schema: AttachmentSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
