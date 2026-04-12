import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type EventRoomType =
  | 'member.joined'
  | 'member.pinded'
  | 'member.edit'
  | 'member.left'
  | 'member.change.role'
  | 'member.create'
  | 'member.added'
  | 'member.deleted'
  | 'member.unPinded'
  | 'member.change.name'
  | 'member.change.avatar'
  | 'member.change.nickName';

@Schema({ timestamps: true, collection: 'RoomEvents' })
export class RoomEvent {
  @Prop({ type: String, unique: true, default: () => Utils.randomId() })
  event_id: string; // ulid/uuid

  @Prop({ type: String, required: true })
  event_type: string; // 'member.joined' | 'message.pinned' | ...

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actor_id: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  targets: Types.ObjectId[];

  @Prop({ type: String, required: true })
  placeholder: string; // 'member.joined' | 'message.pinned' | ...

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  message_id: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  payload: Record<string, any>;
}
export const RoomEventSchema = SchemaFactory.createForClass(RoomEvent);
RoomEventSchema.index({ room_id: 1, createdAt: -1 });

export default { name: 'RoomEvent', schema: RoomEventSchema };
