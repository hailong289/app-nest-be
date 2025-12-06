import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from '@app/helpers/utils';

export type CallHistoryDocument = HydratedDocument<CallHistory>;

export type CallType = 'video' | 'audio';
export type CallStatus =
  | 'initiated'
  | 'started' // Cuộc gọi đã bắt đầu
  | 'ended'; // Cuộc gọi đã kết thúc

export type MemberStatus =
  | 'initiated'
  | 'pending' // người nhận đã nhận cuộc gọi
  | 'started'
  | 'cancelled' // người gọi đã hủy cuộc gọi
  | 'rejected' // người nhận đã từ chối cuộc gọi
  | 'missed' // người nhận đã bỏ qua cuộc gọi
  | 'ended'; // người nhận hoặc người gọi đã kết thúc cuộc gọi

@Schema({ _id: false })
export class Member {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  id: Types.ObjectId;

  @Prop({ type: String, required: true })
  fullname: string;

  @Prop({ type: String, default: '' })
  avatar: string;

  @Prop({ type: Boolean, default: false, required: true })
  is_caller: boolean; // true: người gọi, false: người nhận

  @Prop({
    type: String,
    enum: [
      'initiated',
      'pending',
      'started', // người nhận và người gọi đã bắt đầu cuộc gọi
      'cancelled', // người gọi đã hủy cuộc gọi
      'rejected',
      'missed',
      'ended',
    ],
    default: 'initiated',
    required: true,
  })
  status: MemberStatus;
}

@Schema({ timestamps: true, collection: 'CallHistories' })
export class CallHistory {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  call_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  room_id: Types.ObjectId; // ID phòng gọi

  // tin nhắn cuộc gọi
  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  message_id: Types.ObjectId | null; // ID tin nhắn cuộc gọi

  @Prop({
    type: [Member],
    required: true,
  })
  members: Member[]; // ID các thành viên trong cuộc gọi

  @Prop({
    type: String,
    enum: ['video', 'audio'],
    default: 'audio',
    required: true,
  })
  call_type: CallType; // Loại cuộc gọi

  @Prop({ type: Date, default: Date.now, required: true })
  started_at: Date; // Thời gian bắt đầu cuộc gọi

  @Prop({ type: Date, default: null })
  ended_at: Date | null; // Thời gian kết thúc cuộc gọi

  @Prop({ type: Number, default: 0 })
  duration: number; // Thời gian gọi

  createdAt: Date;
  updatedAt: Date;
}

export const CallHistorySchema = SchemaFactory.createForClass(CallHistory);

/** Indexes */
CallHistorySchema.index({ room_id: 1, started_at: -1 });
CallHistorySchema.index({ 'members.id': 1, started_at: -1 });
CallHistorySchema.index({ 'members.status': 1, started_at: -1 });
CallHistorySchema.index({ call_id: 1 }, { unique: true });

/** Hooks */
// Auto-calculate duration when call ends
CallHistorySchema.pre('save', function (next) {
  if (this.isModified('ended_at') && this.ended_at && this.started_at) {
    const durationMs = this.ended_at.getTime() - this.started_at.getTime();
    this.duration = Math.floor(durationMs / 1000); // Convert to seconds
  }
  next();
});

export default {
  name: 'CallHistory',
  schema: CallHistorySchema,
};
