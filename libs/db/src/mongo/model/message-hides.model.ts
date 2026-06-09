import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageHideDocument = HydratedDocument<MessageHide>;

@Schema({ timestamps: true, collection: 'MessageHides' })
export class MessageHide {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  msg_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  hiddenAt: Date;

  @Prop({ type: String, unique: true })
  uniq: string; // `${msg_id}:${user_id}`
}
export const MessageHideSchema = SchemaFactory.createForClass(MessageHide);
// Index removed: uniq already has unique: true in @Prop
MessageHideSchema.index({ user_id: 1, room_id: 1, msg_id: 1 });
MessageHideSchema.index({ room_id: 1, msg_id: 1 });
// Message-detail pipelines look up hides by msg_id alone (hiddenBy /
// reply hidden). Neither composite index above has msg_id as a prefix,
// so a standalone msg_id index is needed to avoid a collection scan.
MessageHideSchema.index({ msg_id: 1 });

export default { name: 'MessageHide', schema: MessageHideSchema };
