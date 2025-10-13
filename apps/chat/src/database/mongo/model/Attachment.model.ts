import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type AttachmentKind = 'photo' | 'video' | 'file';
export type AttachmentStatus = 'uploaded' | 'processing' | 'failed';

@Schema({ _id: false })
export class Attachment {
  @Prop({ type: String, default: () => Utils.randomId() })
  id: string;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: String, enum: ['photo', 'video', 'file'], required: true })
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
  name: 'AttachmentModel',
  schema: AttachmentSchema,
};
