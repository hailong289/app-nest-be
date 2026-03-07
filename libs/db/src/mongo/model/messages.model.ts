import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;
export type MsgType =
  | 'text'
  | 'image'
  | 'file'
  | 'system'
  | 'video'
  | 'audio'
  | 'gif'
  | 'document'
  | 'quizz';
@Schema({ timestamps: true, collection: 'Messages' })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  msg_roomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  msg_sender: Types.ObjectId;

  @Prop({
    type: String,
    default: 'text',
  })
  msg_type: MsgType;

  @Prop({ type: String, default: '' })
  msg_content: string;

  @Prop({ type: String, default: '' })
  msg_content_norm: string; // search không dấu

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Attachment' }],
    default: [],
  })
  attachment_ids: Types.ObjectId[]; // id từ Attachments collection

  @Prop({ type: Types.ObjectId, ref: 'Document', default: null })
  document_id: Types.ObjectId | null; // Link to Document collection

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  reply_to: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Quiz', default: null })
  quiz_id: Types.ObjectId | null; // Link to Quiz collection

  @Prop({ type: Boolean, default: false })
  pinned: boolean;

  // Xoá cho tất cả
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  deletedReason: string;

  @Prop({ type: String, default: '' })
  placeholder: string; // “Tin nhắn đã bị thu hồi”

  @Prop({ type: Date, default: null })
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export const MessageSchema = SchemaFactory.createForClass(Message);

/** Indexes */
MessageSchema.index({ msg_roomId: 1, createdAt: -1 });
MessageSchema.index({ msg_sender: 1, createdAt: -1 });
MessageSchema.index({ msg_roomId: 1, msg_content_norm: 1 });
MessageSchema.index({ msg_roomId: 1, deletedAt: 1, createdAt: -1 });

/** Hooks */
function normalizeVi(s = '') {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
MessageSchema.pre('save', function (next) {
  // Chỉ normalize khi msg_content có nội dung
  // Với gif, image, video, audio thì msg_content có thể rỗng
  if (this.isModified('msg_content') && this.msg_content) {
    this.msg_content_norm = normalizeVi(this.msg_content);
  } else if (!this.msg_content) {
    // Nếu content rỗng thì msg_content_norm cũng rỗng
    this.msg_content_norm = '';
  }
  next();
});

export default { name: 'Message', schema: MessageSchema };
