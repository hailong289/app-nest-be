import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { ChangeEventType } from '@app/dto/enum.type';

export type UserChangeEventDocument = HydratedDocument<UserChangeEvent>;

/**
 * Outbox / change-feed per-user phục vụ ĐỒNG BỘ CATCH-UP (login / mở lại web).
 *
 * Mỗi row là một thay đổi (tin mới / sửa / xoá / read / room đổi) thuộc về MỘT
 * recipient (`user_id`). Client giữ con trỏ `seq` (toàn cục đơn điệu) và pull
 * `{ user_id, seq > cursor }` để bù phần đã miss khi offline. KHÔNG thay realtime
 * Socket.IO — chỉ phục vụ catch-up. Xem `plan/DONG_BO_EVENT_SYNC.md`.
 *
 * Compaction `room.newmsgs`: thay vì N row "tin mới", giữ MỘT high-water-mark
 * per (user, room) bằng upsert theo `{ user_id, room_id, type }` và bump `seq`.
 */
@Schema({ timestamps: true, collection: 'UserChangeEvents' })
export class UserChangeEvent {
  /** Chủ của feed (recipient). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  /** Con trỏ toàn cục đơn điệu (Redis INCR `CHANGE_SEQ`). Client apply theo seq tăng. */
  @Prop({ type: Number, required: true })
  seq: number;

  @Prop({ type: String, enum: ChangeEventType, required: true })
  type: ChangeEventType;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  /** Payload thin/fat tuỳ `type` (xem bảng 2a trong plan). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  payload: Record<string, unknown>;
}

export const UserChangeEventSchema =
  SchemaFactory.createForClass(UserChangeEvent);

// Pull theo con trỏ: find({ user_id, seq > cursor }).sort({ seq: 1 }).
UserChangeEventSchema.index({ user_id: 1, seq: 1 });
// Compaction high-water-mark `room.newmsgs`: upsert 1 row/(user,room,type).
UserChangeEventSchema.index({ user_id: 1, room_id: 1, type: 1 });
// Retention: TTL 30 ngày kể từ createdAt (Mongoose timestamps).
UserChangeEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

export default { name: 'UserChangeEvent', schema: UserChangeEventSchema };
