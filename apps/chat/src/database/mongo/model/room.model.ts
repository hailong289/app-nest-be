import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
export type RoomDocument = Room & Document;
export type roomType = 'private' | 'group' | 'channel';
export type roleMember = 'member' | 'admin' | 'owner';
export type memberId = {
  user_id: Types.ObjectId;
  role: roleMember;
  joinedAt: Date;
  name: string;
  id: string;
};
export type roomLog = {
  action: string;
  DateAt: Date;
  name: string;
};
const collectionNames = 'Rooms';
const DocumentName = 'Room';
// Explicitly disable _id for subdocuments

@Schema({ timestamps: true, collection: collectionNames })
export class Room {
  @Prop({ type: String, unique: true, default: () => Utils.randomId() })
  room_id: string;

  @Prop({ type: String, enum: ['private', 'group', 'channel'], required: true })
  room_type: roomType;
  @Prop({ type: String, default: '' })
  room_name: string;
  @Prop({ type: String, default: '' })
  room_avatar: string;

  @Prop({ type: Array, default: [] })
  room_members: memberId[];

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  room_lastMessage: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  created_by: Types.ObjectId;

  @Prop({ type: Array, deflaut: [] })
  room_ghim: [];

  @Prop({ type: Array, default: [] })
  room_log: roomLog[];
}

export const RoomSchema = SchemaFactory.createForClass(Room);

export default {
  name: DocumentName,
  schema: RoomSchema,
};
