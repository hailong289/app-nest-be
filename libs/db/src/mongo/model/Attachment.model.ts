import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'file'
  | 'doc'
  | 'json'
  | 'audio';
export enum AttachmentKindEnum {
  image = 'image',
  video = 'video',
  file = 'file',
  doc = 'doc',
  json = 'json',
  audio = 'audio',
}
export type AttachmentStatus = 'uploaded' | 'processing' | 'failed';
export enum AttachmentStatusEnum {
  uploaded = 'uploaded',
  processing = 'processing',
  failed = 'failed',
}
export type AttachmentContextType = 'message' | 'doc' | 'other';
export enum AttachmentContextEnumType {
  mesage = 'message',
  doc = 'doc',
  other = 'other',
}
@Schema({ collection: 'Attachments', timestamps: true })
export class Attachment {
  @Prop({ type: Types.ObjectId, ref: 'Rooms', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({
    type: String,
    enum: AttachmentKindEnum,
    required: true,
  })
  kind: AttachmentKind;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String })
  name?: string;

  @Prop({ type: Number, required: true })
  size: number;

  @Prop({ type: String, required: true })
  mimeType: string;

  @Prop({ type: String })
  thumbUrl?: string;

  @Prop({
    type: String,
    enum: AttachmentStatusEnum,
    default: AttachmentStatusEnum.uploaded,
  })
  status?: AttachmentStatus;

  @Prop({ type: Number })
  width?: number;

  @Prop({ type: Number })
  height?: number;

  @Prop({ type: Number })
  duration?: number;
  @Prop({
    type: String,
    enum: AttachmentContextEnumType,
    default: AttachmentContextEnumType.mesage,
  })
  contextType: AttachmentContextType;

  @Prop({ type: Types.ObjectId, default: null })
  contextId?: Types.ObjectId; // message_id hoặc document_id
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

export default {
  name: 'Attachment',
  schema: AttachmentSchema,
};
