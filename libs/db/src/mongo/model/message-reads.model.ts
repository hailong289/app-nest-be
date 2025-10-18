import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageReadDocument = HydratedDocument<MessageRead>;

@Schema({ timestamps: true, collection: 'MessageReads' })
export class MessageRead {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  msg_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  readAt: Date;

  @Prop({ type: String, unique: true })
  uniq: string; // `${msg_id}:${user_id}`
}
export const MessageReadSchema = SchemaFactory.createForClass(MessageRead);
// Index removed: uniq already has unique: true in @Prop
MessageReadSchema.index({ user_id: 1, room_id: 1, msg_id: 1 });

export default { name: 'MessageRead', schema: MessageReadSchema };
