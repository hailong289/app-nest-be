import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type friendship =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'INVALID';
const collectionName = 'Friendships';
const modelName = 'Friendship';

@Schema({ timestamps: true, collection: collectionName })
export class Friendship {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  frp_id: string;

  @Prop({ type: String, required: true })
  frp_userId1: string;

  @Prop({ type: String, required: true })
  frp_userId2: string;

  @Prop({ type: String, required: true })
  frp_actionUserId: string;

  @Prop({
    type: String,
    enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'BLOCKED'],
    required: true,
  })
  frp_status: friendship;
}

export default {
  name: modelName,
  schema: SchemaFactory.createForClass(Friendship),
};
