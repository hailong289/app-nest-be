import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from 'libs/db/src';
import { MessageStoreRecord } from '@app/dto';

/**
 * Ghi message row (write-behind) từ topic `chat.messageStore`. Upsert theo `_id`
 * cố định → idempotent (Kafka redeliver an toàn, client tự cấp id trùng cũng OK).
 * CHỈ `$set` field bất biến lúc tạo (không pinned/editedAt/deletedAt) để không đè
 * mutation react/pin/edit đến sau. Xem plan write-behind (A4).
 */
@Injectable()
export class MessageStoreService {
  private readonly logger = new Logger(MessageStoreService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
  ) {}

  /** Tổng số message đã xử lý từ lúc start (để theo dõi hoạt động). */
  private processed = 0;

  async persist(record: MessageStoreRecord): Promise<void> {
    if (!record?._id) {
      this.logger.warn('⤳ nhận record rỗng/thiếu _id → bỏ qua');
      return;
    }
    const t0 = Date.now();
    try {
      const res = await this.messageModel.updateOne(
        { _id: new Types.ObjectId(record._id) },
        { $set: this.mapRecordToDoc(record) },
        { upsert: true },
      );
      this.processed++;
      // inserted = ghi mới; updated/none = redeliver (idempotent đã chạy đúng).
      const action = res.upsertedCount
        ? 'inserted'
        : res.modifiedCount
          ? 'updated'
          : 'noop(dup)';
      this.logger.log(
        `✓ stored msg=${record._id} room=${record.msg_roomId} type=${record.msg_type} ` +
          `[${action}] ${Date.now() - t0}ms (total=${this.processed})`,
      );
    } catch (err) {
      // Ném lại để NestJS Kafka không commit offset → redeliver (idempotent).
      this.logger.error(
        `✗ persist message fail (msg=${record._id} room=${record.msg_roomId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  /**
   * Ghi LÔ (bulk) nhiều record — dùng bởi consumer eachBatch. `updateOne` upsert
   * theo `_id` → idempotent (redeliver/ghi lại an toàn). `ordered:false` để 1 op
   * lỗi không chặn cả lô. NÉM lỗi ra ngoài để consumer KHÔNG commit offset → retry
   * (đảm bảo không bỏ sót). Trả số record đã xử lý.
   */
  async persistMany(records: MessageStoreRecord[]): Promise<number> {
    const valid = records.filter((r) => r?._id);
    if (!valid.length) return 0;
    const ops = valid.map((r) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(r._id) },
        update: { $set: this.mapRecordToDoc(r) },
        upsert: true,
      },
    }));
    const t0 = Date.now();
    const res = await this.messageModel.bulkWrite(ops, { ordered: false });
    this.processed += valid.length;
    this.logger.log(
      `✓ bulk stored ${valid.length} msgs [ins=${res.upsertedCount ?? 0} ` +
        `upd=${res.modifiedCount ?? 0}] ${Date.now() - t0}ms (total=${this.processed})`,
    );
    return valid.length;
  }

  private mapRecordToDoc(r: MessageStoreRecord) {
    const oid = (v: string | null): Types.ObjectId | null =>
      v ? new Types.ObjectId(v) : null;
    return {
      msg_roomId: new Types.ObjectId(r.msg_roomId),
      msg_sender: new Types.ObjectId(r.msg_sender),
      msg_content: r.msg_content,
      reply_to: oid(r.reply_to),
      attachment_ids: r.attachment_ids.map((i) => new Types.ObjectId(i)),
      msg_type: r.msg_type as Message['msg_type'],
      document_id: oid(r.document_id),
      quiz_id: oid(r.quiz_id),
      desk_id: oid(r.desk_id),
      todo_project_id: oid(r.todo_project_id),
      createdAt: new Date(r.createdAt),
      // Seq cho read-receipt HWM (null nếu change-feed tắt / không cấp được).
      msg_seq: r.seq && r.seq > 0 ? r.seq : null,
    };
  }
}
