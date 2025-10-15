import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Schema as MongooseSchema } from 'mongoose';

export type eventType = 'readed' | 'del_only_me' | 'del_for_all';
const collectionName = 'event_messages';
const modelName = 'event_message';
@Schema({ timestamps: true, collection: collectionName })
export class MsgEvent {
  @Prop({
    type: String,
    enum: ['readed', 'del_only_me', 'del_for_all'],
    required: true,
  })
  type: eventType;

  @Prop({ type: String, required: true })
  msg_id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}
export const MsgEventSchema = SchemaFactory.createForClass(MsgEvent);

export default {
  name: modelName,
  schema: MsgEventSchema,
};
