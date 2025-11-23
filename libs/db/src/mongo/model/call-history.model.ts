import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from '@app/helpers/utils';

export type CallHistoryDocument = HydratedDocument<CallHistory>;

export type CallType = 'video' | 'audio';
export type CallStatus =
  | 'initiated'
  | 'answered'
  | 'ended'
  | 'missed'
  | 'rejected'; 

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

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  caller_id: Types.ObjectId; // Người gọi cuộc gọi

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  callee_id: Types.ObjectId; // Người nhận cuộc gọi

  @Prop({
    type: String,
    enum: ['video', 'audio'],
    default: 'audio',
    required: true,
  })
  call_type: CallType; // Loại cuộc gọi

  @Prop({
    type: String,
    enum: ['initiated', 'answered', 'ended', 'missed', 'rejected'],
    default: 'initiated',
    required: true,
    index: true,
  })
  status: CallStatus; // Trạng thái cuộc gọi

  @Prop({ type: Date, default: Date.now, required: true })
  started_at: Date; // Thời gian bắt đầu cuộc gọi

  @Prop({ type: Date, default: null })
  answered_at: Date | null; // Thời gian trả lời cuộc gọi

  @Prop({ type: Date, default: null })
  ended_at: Date | null; // Thời gian kết thúc cuộc gọi

  @Prop({ type: Number, default: 0 })
  duration: number; // Thời gian gọi

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  ended_by: Types.ObjectId | null; // Người kết thúc cuộc gọi

  @Prop({ type: String, default: '' })
  end_reason: string; // Lý do kết thúc (ví dụ: 'normal', 'timeout', 'error')

  createdAt: Date;
  updatedAt: Date;
}

export const CallHistorySchema = SchemaFactory.createForClass(CallHistory);

/** Indexes */
CallHistorySchema.index({ room_id: 1, started_at: -1 });
CallHistorySchema.index({ caller_id: 1, started_at: -1 });
CallHistorySchema.index({ callee_id: 1, started_at: -1 });
CallHistorySchema.index({ status: 1, started_at: -1 });
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
