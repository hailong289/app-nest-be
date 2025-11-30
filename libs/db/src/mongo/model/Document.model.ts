import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type DocVisibility = 'private' | 'room' | 'public';

/**
 * Document = tài liệu + wiki + ghi chú dài + nội dung collaborative (Yjs)
 */
@Schema({
  collection: 'Documents',
  timestamps: true, // tự sinh createdAt + updatedAt
})
export class Document {
  /* =============================
   *  BASIC INFO
   * ============================= */

  @Prop({ required: true })
  title: string;

  /**
   * Chủ sở hữu tài liệu (user_id từ hệ thống)
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  /**
   * Tài liệu có thể gắn với một Room/Channel/Lớp
   * Nếu không gắn → tài liệu cá nhân kiểu Notion
   */
  @Prop({ type: Types.ObjectId, ref: 'Rooms', default: null })
  roomId?: Types.ObjectId | null;

  /**
   * Visibility:
   *  - private: chỉ owner (và share)
   *  - room: tất cả thành viên phòng/lớp xem được
   *  - public: tuyên giáo luôn =))
   */
  @Prop({
    type: String,
    enum: ['private', 'room', 'public'],
    default: 'private',
  })
  visibility: DocVisibility;

  /* =============================
   *  YJS SNAPSHOT STORAGE
   * ============================= */

  /**
   * Yjs snapshot (Uint8Array → Buffer)
   * FE sẽ encode base64 → BE decode → Buffer
   */
  @Prop({ type: Buffer, default: null })
  yjsSnapshot: Buffer | null;

  /**
   * Text plain (để search full-text, highlight, preview)
   * FE lấy từ editor.getText() hoặc parse state
   */
  @Prop({ type: String, default: '' })
  plainText: string;

  /* =============================
   *  ATTACHMENTS
   * ============================= */

  /**
   * Danh sách file đính kèm (Attachment model)
   * Không bắt buộc, vì file vẫn nằm trong Yjs JSON
   * Nhưng field này giúp:
   *  - cleanup S3 khi xoá doc
   *  - hiện danh sách file ở sidebar
   */
  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Attachment' }],
    default: [],
  })
  attachmentIds: Types.ObjectId[];

  /* =============================
   *  SHARING (optional)
   * ============================= */

  /**
   * Chia sẻ cho user khác
   * role:
   *  - viewer: chỉ xem
   *  - editor: được sửa
   */
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        role: { type: String, enum: ['viewer', 'editor'] },
      },
    ],
    default: [],
  })
  sharedWith?: {
    userId: Types.ObjectId;
    role: 'viewer' | 'editor';
  }[];
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

export default {
  name: 'Document',
  schema: DocumentSchema,
};
