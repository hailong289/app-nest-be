import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type friendship = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
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

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  frp_userId1: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  frp_userId2: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  frp_actionUserId: Types.ObjectId;

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
