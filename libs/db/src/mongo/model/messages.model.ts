import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';
export type msgType = 'text' | 'file' | 'log' | 'call';
export type MessageDocument = HydratedDocument<Message>;
const collectionNames = 'Messages';
const DocumentName = 'Message';
@Schema({ timestamps: true, collection: collectionNames })
export class Message {
  @Prop({ type: String, default: () => Utils.randomId(), unique: true })
  msg_id: string;

  @Prop({ type: String, default: '' })
  msg_content: string | null;

  @Prop({ type: Array, default: [] })
  msg_attachments: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  msg_sender: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  msg_room: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['text', 'image', 'video', 'file'],
    default: 'text',
  })
  msg_type: msgType;

  @Prop({ type: Boolean, default: false })
  msg_deleted: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  msg_replyTo: string | null;
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
  name: DocumentName,
  schema: MessageSchema,
};
