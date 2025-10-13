import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import Utils from 'libs/helpers/utils';
import { Attachment, AttachmentSchema } from './Attachment.model';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ timestamps: true, collection: 'Messages' })
export class Message {
  @Prop({ type: String, default: () => Utils.randomId(), unique: true })
  msg_id: string;

  @Prop({ type: String, default: '' })
  msg_content: string;

  @Prop({ type: [AttachmentSchema], default: [] })
  msg_attachments: Attachment[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  msg_sender: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  msg_room: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['text', 'image', 'video', 'file'],
    default: 'text',
  })
  msg_type: 'text' | 'image' | 'video' | 'file';

  @Prop({ type: Boolean, default: false })
  msg_deleted: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Message', default: null })
  msg_replyTo: Types.ObjectId | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Indexes
MessageSchema.index({ msg_room: 1, msg_sender: 1 });

// Pre-save hook to trim content
MessageSchema.pre('save', function (next) {
  try {
    if (
      this.isModified('msg_content') &&
      typeof this.msg_content === 'string'
    ) {
      this.msg_content = this.msg_content.trim();
    }
  } catch {
    // ignore
  }
  next();
});

export default {
  name: 'MessageModel',
  schema: MessageSchema,
};
