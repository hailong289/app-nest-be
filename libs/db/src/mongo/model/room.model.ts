import Utils from '@app/helpers/utils';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;
export enum RoomTypeEnum {
  Private = 'private',
  Group = 'group',
  Channel = 'channel',
}
export type roomType = 'private' | 'group' | 'channel';
export type roleMember = 'member' | 'admin' | 'owner' | 'guest';
export type memberType = {
  user_id: Types.ObjectId;
  role: roleMember;
  joinedAt?: Date;
  name: string;
  id: string;
};
@Schema({ _id: false }) // subdoc không có _id
export class Member {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['member', 'admin', 'owner', 'guest'],
    default: 'member',
  })
  role: roleMember;

  @Prop({ type: Date, default: Date.now })
  joinedAt: Date;

  @Prop({ type: String, default: '' })
  name: string;

  // id hiển thị (tuỳ UI), không bắt buộc lưu; giữ lại nếu bạn đang dùng:
  @Prop({ type: String, default: '' })
  id: string;
}
export const MemberSchema = SchemaFactory.createForClass(Member);

const collectionNames = 'Rooms';
const DocumentName = 'Room';

@Schema({ timestamps: true, collection: collectionNames })
export class Room {
  @Prop({ type: String, unique: true, default: () => Utils.randomId() })
  room_id: string;

  @Prop({ type: String, enum: ['private', 'group', 'channel'], required: true })
  room_type: roomType;

  @Prop({ type: String, default: '' })
  room_name: string;

  // tên đã chuẩn hoá (không dấu, lowercase) để search nhanh
  @Prop({ type: String, default: '' })
  room_name_norm: string;

  @Prop({ type: String, default: '' })
  room_avatar: string;

  @Prop({ type: [MemberSchema], default: [] })
  room_members: Member[];

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  room_lastMessage: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  created_by: Types.ObjectId | null;

  // danh sách message bị ghim trong room
  @Prop({ type: [Types.ObjectId], ref: 'Message', default: [] })
  room_ghim: Types.ObjectId[];
}

export const RoomSchema = SchemaFactory.createForClass(Room);

/** Indexes */
RoomSchema.index({ room_type: 1 });
RoomSchema.index({ room_lastMessage: -1 });
RoomSchema.index({ updatedAt: -1 });
RoomSchema.index({ room_name_norm: 1 });
RoomSchema.index({ room_type: 1, 'room_members.user_id': 1 });

/** ===== Helpers ===== */
// Chuẩn hoá tiếng Việt (không dấu, lowercase)
function normalizeVi(s = '') {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// Auto set room_name_norm
RoomSchema.pre('save', function (next) {
  if (this.isModified('room_name')) {
    this.room_name_norm = normalizeVi(this.room_name || '');
  }
  next();
});

// Ràng buộc: private phải có đúng 2 members (tuỳ chọn – bật nếu chắc logic)
// RoomSchema.pre('validate', function (next) {
//   if (this.room_type === 'private') {
//     if (!Array.isArray(this.room_members) || this.room_members.length !== 2) {
//       return next(new Error('Private room must contain exactly 2 members.'));
//     }
//   }
//   next();
// });

export default {
  name: DocumentName,
  schema: RoomSchema,
};
