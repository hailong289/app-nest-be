import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type roomType = 'private' | 'group' | 'channel';

export class RoomMember {
  @Prop({ type: String, required: true })
  user_id: string;
  @Prop({ type: String, enum: ['member', 'admin', 'owner'], default: 'member' })
  role: 'member' | 'admin' | 'owner';
  @Prop({ type: Date, default: Date.now })
  joinedAt: Date;
}
export const RoomMemberSchema = SchemaFactory.createForClass(RoomMember);

@Schema({ timestamps: true })
export class Room {
  @Prop({ type: String, unique: true, default: () => Utils.randomId() })
  room_id: string;

  @Prop({ type: String, enum: ['private', 'group', 'channel'], required: true })
  room_type: roomType;
  @Prop({ type: String, default: '' })
  room_name: string;
  @Prop({ type: String, default: '' })
  room_avatar: string;

  @Prop({ type: [RoomMemberSchema], default: [] })
  members: RoomMember[];
}
