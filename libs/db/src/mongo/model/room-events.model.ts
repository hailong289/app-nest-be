import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * EventRoomType is now defined in libs/types/src/room-event.types.ts.
 * Re-exported here for backward compatibility.
 * @see libs/types/src/room-event.types.ts
 */
export type { EventRoomType } from 'libs/types';

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
