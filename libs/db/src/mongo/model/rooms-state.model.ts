import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomsStateDocument = HydratedDocument<RoomsState>;

@Schema({ timestamps: true, collection: 'RoomsState' })
export class RoomsState {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room_id: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  last_message_id: Types.ObjectId | null;

  @Prop({
    type: {
      content: String,
      sender_id: { type: Types.ObjectId, ref: 'User' },
      createdAt: Date,
    },
    default: null,
  })
  last_message_snapshot: {
    content: string;
    sender_id: Types.ObjectId;
    createdAt: Date;
  } | null;
}
export const RoomsStateSchema = SchemaFactory.createForClass(RoomsState);
RoomsStateSchema.index({ updatedAt: -1 }); // sort list
// Join key cho $lookup từ Room._id → RoomsState.room_id (GetRooms/getRoomInfo).
// Thiếu index này khiến mỗi lookup state quét toàn bộ collection.
RoomsStateSchema.index({ room_id: 1 });

export default { name: 'RoomsState', schema: RoomsStateSchema };
