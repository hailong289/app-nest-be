import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomsUsersStateDocument = HydratedDocument<RoomsUsersState>;

@Schema({ timestamps: true, collection: 'RoomsUsersState' })
export class RoomsUsersState {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  last_read_msg_id: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  last_read_at: Date | null;

  /**
   * HIGH-WATER-MARK đọc theo `seq`: seq của tin cuối user đã đọc trong phòng.
   * FE suy ra mọi tin `msg_seq <= last_read_seq` là đã đọc (quét local, không
   * cần read_by per-message). null nếu chưa đọc / tin không có seq.
   */
  @Prop({ type: Number, default: null })
  last_read_seq: number | null;

  @Prop({ type: Number, default: 0, min: 0 })
  unread_count: number;

  @Prop({ type: Boolean, default: false })
  muted: boolean;

  @Prop({ type: Boolean, default: false })
  pinned: boolean;

  @Prop({ type: Date, default: Date.now() })
  pinned_at: Date | null; // optional

  // Clear history (xoá tất cả CHỈ MÌNH) – ẩn mọi msg cũ hơn mốc này
  @Prop({ type: Date, default: null })
  clear_before_ts: Date | null;
}
export const RoomsUsersStateSchema =
  SchemaFactory.createForClass(RoomsUsersState);
RoomsUsersStateSchema.index({ user_id: 1, room_id: 1 }, { unique: true });
RoomsUsersStateSchema.index({ user_id: 1, unread_count: -1 });

export default { name: 'RoomsUsersState', schema: RoomsUsersStateSchema };
