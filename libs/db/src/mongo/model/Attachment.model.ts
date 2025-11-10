import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'file'
  | 'doc'
  | 'json'
  | 'audio';
export type AttachmentStatus = 'uploaded' | 'processing' | 'failed';

@Schema({ collection: 'Attachments', timestamps: true })
export class Attachment {
  @Prop({ type: Types.ObjectId, ref: 'Rooms', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['image', 'video', 'file', 'doc', 'json', 'audio'],
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
    enum: ['uploaded', 'processing', 'failed'],
    default: 'uploaded',
  })
  status?: AttachmentStatus;

  @Prop({ type: Number })
  width?: number;

  @Prop({ type: Number })
  height?: number;

  @Prop({ type: Number })
  duration?: number;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

export default {
  name: 'Attachment',
  schema: AttachmentSchema,
};
