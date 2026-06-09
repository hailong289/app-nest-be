/**
 * Contract của topic `chat.messageStore` (write-behind lưu message row).
 * Producer: chat `createMessage` (key = roomMongoId). Consumer: app `chat-storage`
 * → bulk/upsert vào MongoDB. CHỈ field BẤT BIẾN lúc tạo (không pinned/editedAt/
 * deletedAt → tránh đè mutation react/pin/edit đến sau). Mọi id/date là string
 * để JSON-serialize qua Kafka an toàn; consumer convert lại ObjectId/Date.
 */
export type MessageStoreRecord = {
  _id: string;
  msg_roomId: string;
  msg_sender: string;
  msg_content: string;
  reply_to: string | null;
  attachment_ids: string[];
  msg_type: string;
  document_id: string | null;
  quiz_id: string | null;
  desk_id: string | null;
  todo_project_id: string | null;
  /** ISO string. Bằng đúng createdAt đã broadcast realtime. */
  createdAt: string;
  /** Seq change-feed cấp lúc tạo (cho read-receipt HWM). 0/undefined nếu tắt. */
  seq?: number;
};
