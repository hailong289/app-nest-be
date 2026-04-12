import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';

export type NotificationDocument = HydratedDocument<Notification>;

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'message'
  | 'room_invite'
  | 'system'
  | 'other';

@Schema({ timestamps: true, collection: 'Notifications' })
export class Notification {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  noti_id: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  noti_userId: Types.ObjectId; // Người nhận thông báo

  @Prop({
    type: String,
    enum: [
      'friend_request',
      'friend_accepted',
      'friend_rejected',
      'message',
      'room_invite',
      'system',
      'other',
    ],
    required: true,
    default: 'other',
  })
  noti_type: NotificationType;

  @Prop({ type: String, required: true })
  noti_title: string; // Tiêu đề thông báo

  @Prop({ type: String, default: '' })
  noti_content: string; // Nội dung thông báo

  @Prop({ type: Boolean, default: false, index: true })
  noti_read: boolean; // Đã đọc chưa

  @Prop({ type: Date, default: null })
  noti_readAt: Date | null; // Thời gian đọc

  // Dữ liệu bổ sung dạng JSON (flexible)
  @Prop({ type: Object, default: {} })
  noti_metadata: Record<string, any>;

  @Prop({ type: String, default: '' })
  noti_image: string; // Ảnh đại diện thông báo (nếu có)

  @Prop({
    type: String,
    enum: ['info', 'success', 'warning', 'error'],
    default: 'info',
  })
  noti_level: string; // Mức độ thông báo
  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/** Indexes */
NotificationSchema.index({ noti_userId: 1, noti_read: 1, createdAt: -1 });
NotificationSchema.index({ noti_userId: 1, createdAt: -1 });
NotificationSchema.index({ noti_type: 1, createdAt: -1 });

export default {
  name: 'Notification',
  schema: NotificationSchema,
};
