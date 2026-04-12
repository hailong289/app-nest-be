import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageReactionDocument = HydratedDocument<MessageReaction>;

@Schema({ timestamps: true, collection: 'MessageReactions' })
export class MessageReaction {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  msg_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  emoji: string;

  @Prop({ type: String, unique: true })
  uniq: string; // `${msg_id}:${user_id}:${emoji}`
}
export const MessageReactionSchema =
  SchemaFactory.createForClass(MessageReaction);
// Index removed: uniq already has unique: true in @Prop
MessageReactionSchema.index({ msg_id: 1, emoji: 1 });

export default { name: 'MessageReaction', schema: MessageReactionSchema };
