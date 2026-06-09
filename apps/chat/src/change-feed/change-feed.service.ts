import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import { Model, Types } from 'mongoose';
import { UserChangeEvent } from 'libs/db/src';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { SERVICES } from '@app/constants';
import { REDISKEY } from '@app/constants/RedisKey';
import { ChangeEventType, KafkaEvent } from '@app/dto/enum.type';
import Utils from '@app/helpers/utils';

/** Retention change-feed: doc hết hạn sau ngần này (TTL theo `expireAt`). */
export const CHANGEFEED_RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 ngày
/** Cap mềm: giữ tối đa ngần này event/user (trim job cắt phần cũ vượt ngưỡng). */
export const CHANGEFEED_MAX_PER_USER = 5000;

/**
 * Payload của Kafka event `OUTBOX_APPEND`. `seq` được cấp ĐỒNG BỘ ở `emit()`
 * (Redis INCR) trước khi dispatch, nên caller có thể gắn cùng `seq` đó vào
 * payload realtime Socket.IO → một nguồn `seq` duy nhất cho cả 2 đường (live +
 * catch-up). Xem plan/DONG_BO_EVENT_SYNC.md.
 */
export interface OutboxAppendPayload {
  seq: number;
  type: ChangeEventType;
  /** room Mongo `_id` (string). */
  roomId: string;
  /** recipient user Mongo `_id` (string[]). */
  recipients: string[];
  payload: Record<string, unknown>;
}

/**
 * Ghi change-feed (outbox per-user) phục vụ ĐỒNG BỘ CATCH-UP. KHÔNG thay realtime.
 *
 * - `emit()`: cấp `seq` (INCR toàn cục) rồi dispatch Kafka `OUTBOX_APPEND` —
 *   off hot-path, không chặn mutation.
 * - `handleOutboxAppend()` (consumer): bulkWrite per-recipient vào
 *   `UserChangeEvents`. `room.newmsgs` dùng upsert HWM (compaction) thay vì N row.
 */
@Injectable()
export class ChangeFeedService implements OnModuleInit {
  private readonly logger = new Logger(ChangeFeedService.name);

  /**
   * Rollout kill-switch. `CHANGEFEED_ENABLED=false` → ngừng cấp seq + ghi outbox
   * (mutation + realtime vẫn chạy như cũ; FE tự fallback full-load). Mặc định bật.
   */
  private readonly enabled = process.env.CHANGEFEED_ENABLED !== 'false';

  constructor(
    @InjectModel(UserChangeEvent.name)
    private readonly changeEventModel: Model<UserChangeEvent>,
    @Inject(SERVICES.CHAT)
    private readonly chatClient: ClientKafka,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `[CF] ChangeFeedService init — enabled=${this.enabled} (CHANGEFEED_ENABLED=${process.env.CHANGEFEED_ENABLED ?? 'unset→default true'})`,
    );
    if (!this.enabled) {
      this.logger.warn('Change-feed DISABLED (CHANGEFEED_ENABLED=false)');
    }
    // Drop TTL index legacy trên `createdAt` (Sprint 1) — nay TTL theo `expireAt`
    // để HWM upsert refresh được hạn. Idempotent: bỏ qua nếu index không tồn tại.
    try {
      await this.changeEventModel.collection.dropIndex('createdAt_1');
      this.logger.log('Dropped legacy TTL index createdAt_1');
    } catch {
      /* index không tồn tại → bỏ qua */
    }
  }

  /**
   * Cấp một `seq` mới (INCR toàn cục). Dùng khi caller cần seq SỚM để gắn vào
   * payload realtime TRƯỚC khi outbox được ghi ở chỗ khác (vd createMessage cấp
   * seq, gắn vào MSGUPSERT, rồi truyền seq sang tail `handleMessagePersisted`).
   * Trả 0 khi change-feed tắt (rollout) → caller không gắn seq, không ghi outbox.
   */
  async nextSeq(): Promise<number> {
    if (!this.enabled) return 0;
    try {
      return await this.redis.incrPersist(REDISKEY.CHANGE_SEQ());
    } catch (err) {
      // Change-feed là phụ — KHÔNG được làm hỏng mutation gốc. Cấp seq lỗi (vd
      // Redis blip) → trả 0, bỏ qua outbox lần này (client tự bù qua
      // cold-start / requireFullResync). Đây là contract "fire-and-forget":
      // cả emit() lẫn nextSeq() KHÔNG BAO GIỜ throw ra ngoài.
      this.logger.error(
        `[change-feed] nextSeq failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  /**
   * Phát `OUTBOX_APPEND` với `seq` cho trước (không INCR). Dùng khi seq đã được
   * cấp sớm ở `nextSeq()` để live + catch-up dùng CHUNG một seq. No-op nếu
   * không có recipient.
   */
  async emitWithSeq(
    seq: number,
    params: {
      type: ChangeEventType;
      roomId: string;
      recipients: string[];
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const { type, roomId, recipients, payload } = params;
    if (!recipients?.length || !seq) {
      this.logger.debug(
        `[CF] emitWithSeq skip type=${type} seq=${seq} recipients=${recipients?.length ?? 0}`,
      );
      return;
    }
    try {
      this.logger.log(
        `[CF] → dispatch OUTBOX_APPEND type=${type} seq=${seq} room=${roomId} recipients=${recipients.length}`,
      );
      // QUAN TRỌNG: dispatchEventKafka KHÔNG throw khi produce lỗi — nó TRẢ VỀ
      // Response.error. Trước đây ta bỏ qua giá trị này → nuốt lỗi âm thầm.
      // Giờ log thẳng kết quả để thấy produce có thành công không.
      const res = await Utils.dispatchEventKafka(
        this.chatClient,
        KafkaEvent.OUTBOX_APPEND,
        {
          seq,
          type,
          roomId,
          recipients,
          payload,
        } satisfies OutboxAppendPayload,
        // Key theo room → cùng phòng cùng partition → consumer ghi outbox theo
        // đúng thứ tự seq (topic OUTBOX_APPEND nay nhiều partition). Tránh HWM
        // `room.newmsgs` bị seq cũ ghi đè seq mới.
        roomId,
      );
      const sc = (res as { statusCode?: number })?.statusCode;
      if (sc && sc >= 400) {
        this.logger.error(
          `[CF] ✗ dispatch OUTBOX_APPEND FAILED type=${type} seq=${seq}: ${JSON.stringify(res)}`,
        );
      } else {
        this.logger.log(
          `[CF] ✓ dispatch OUTBOX_APPEND OK type=${type} seq=${seq} (statusCode=${sc ?? 'n/a'})`,
        );
      }
    } catch (err) {
      // Outbox là phần CATCH-UP — lỗi ở đây KHÔNG được làm hỏng mutation gốc
      // (đã commit + emit realtime). Client vẫn nhận live; lần sync sau bù.
      this.logger.error(
        `[CF] ✗ dispatch OUTBOX_APPEND THREW type=${type} seq=${seq}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Cấp `seq` rồi phát event để consumer ghi outbox. Trả `seq` để caller gắn
   * cùng giá trị vào payload realtime (live + catch-up chung seq). No-op nếu
   * không có recipient.
   */
  async emit(params: {
    type: ChangeEventType;
    roomId: string;
    recipients: string[];
    payload: Record<string, unknown>;
  }): Promise<number> {
    if (!params.recipients?.length) return 0;
    const seq = await this.nextSeq();
    await this.emitWithSeq(seq, params);
    return seq;
  }

  /**
   * Consumer `OUTBOX_APPEND`: ghi 1 row/recipient. `room.newmsgs` upsert HWM
   * theo `{user_id, room_id, type}` (mỗi user-phòng chỉ 1 high-water-mark);
   * còn lại insert. `ordered:false` để 1 recipient lỗi không chặn phần còn lại.
   */
  async handleOutboxAppend(data: OutboxAppendPayload): Promise<void> {
    const { seq, type, roomId, recipients, payload } = data;
    this.logger.log(
      `[CF] ← CONSUME OUTBOX_APPEND type=${type} seq=${seq} room=${roomId} recipients=${recipients?.length ?? 0}`,
    );
    if (!recipients?.length) return;

    const roomObjId = Utils.convertToObjectIdMongoose(roomId);
    const isHwm = type === ChangeEventType.ROOM_NEWMSGS;
    // Refresh hạn TTL ở MỖI lần ghi (kể cả HWM upsert) → phòng còn hoạt động
    // không bị xoá nhầm. Xem model `expireAt`.
    const expireAt = new Date(Date.now() + CHANGEFEED_RETENTION_SECONDS * 1000);

    const ops = recipients.map((uid) => {
      const user_id = new Types.ObjectId(uid);
      if (isHwm) {
        return {
          updateOne: {
            filter: { user_id, room_id: roomObjId, type },
            update: { $set: { seq, payload, expireAt } },
            upsert: true,
          },
        };
      }
      return {
        insertOne: {
          document: {
            user_id,
            room_id: roomObjId,
            type,
            seq,
            payload,
            expireAt,
          },
        },
      };
    });

    try {
      const result = await this.changeEventModel.bulkWrite(ops, {
        ordered: false,
      });
      this.logger.log(
        `[CF] ✓ WROTE outbox type=${type} seq=${seq} inserted=${result.insertedCount} upserted=${result.upsertedCount} modified=${result.modifiedCount}`,
      );
    } catch (err) {
      this.logger.error(
        `[CF] ✗ bulkWrite FAILED type=${type} seq=${seq}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err; // để onOutboxAppend log + Kafka retry
    }

    // Đánh dấu user "dirty" để job trim cap chỉ xử lý user có thay đổi (mục 5a).
    await this.redis.sAdd(REDISKEY.CHANGEFEED_DIRTY(), ...recipients);

    // Nâng watermark "đã ghi" = max(hiện tại, seq) → syncEvents phân biệt được
    // "lag thật" vs "user chỉ tụt sau seq toàn cục của người khác". Get-set
    // (không atomic, chấp nhận vì chỉ là HINT cho retry). Lỗi → bỏ qua.
    try {
      const curRaw = await this.redis.client.get(REDISKEY.CHANGE_WRITTEN_SEQ());
      const cur = Number(curRaw) || 0;
      if (seq > cur) {
        await this.redis.client.set(REDISKEY.CHANGE_WRITTEN_SEQ(), String(seq));
      }
    } catch {
      /* hint-only, bỏ qua lỗi */
    }
  }

  /**
   * Cap mềm: giữ tối đa `CHANGEFEED_MAX_PER_USER` event mới nhất của 1 user, xoá
   * phần cũ vượt ngưỡng. Lấy `seq` của event ở vị trí thứ CAP (sort giảm dần) làm
   * mốc rồi `deleteMany(seq <= mốc)`. No-op nếu user có ≤ CAP event. Trả số đã xoá.
   */
  async trimUserToCap(userId: string): Promise<number> {
    const uid = new Types.ObjectId(userId);
    const cutoff = await this.changeEventModel
      .findOne({ user_id: uid })
      .sort({ seq: -1 })
      .skip(CHANGEFEED_MAX_PER_USER)
      .select('seq')
      .lean();
    if (!cutoff) return 0;
    const res = await this.changeEventModel.deleteMany({
      user_id: uid,
      seq: { $lte: cutoff.seq },
    });
    return res.deletedCount ?? 0;
  }

  /**
   * Pull change-feed kể từ con trỏ `sinceSeq` cho catch-up sync (gRPC SyncEvents).
   * Trả tối đa `limit` event theo `seq` tăng + `nextSeq`/`hasMore`. Đặt
   * `requireFullResync=true` khi con trỏ đã cũ hơn event nhỏ nhất còn lưu (đã bị
   * TTL/trim cắt) → client phải cold-start full-load. `payload` serialize JSON
   * để qua gRPC an toàn (proto chỉ có `payloadJson`).
   */
  async syncEvents(params: {
    userId: string;
    sinceSeq?: number;
    limit?: number;
  }): Promise<{
    events: Array<{
      seq: number;
      type: string;
      roomId: string;
      payloadJson: string;
      createdAt: string;
    }>;
    nextSeq: number;
    hasMore: boolean;
    requireFullResync: boolean;
    currentSeq: number;
    mayHavePending: boolean;
  }> {
    const userId = new Types.ObjectId(params.userId);
    const sinceSeq = Number(params.sinceSeq ?? 0);
    const limit = Math.min(Math.max(Number(params.limit ?? 200), 1), 500);

    // Cursor cũ hơn event nhỏ nhất còn lưu (retention đã cắt) → full-resync.
    // Chỉ xét khi client thực sự đã có cursor (>0); sinceSeq=0 nghĩa là pull từ đầu.
    const oldest = await this.changeEventModel
      .findOne({ user_id: userId })
      .sort({ seq: 1 })
      .select('seq')
      .lean();
    const requireFullResync =
      sinceSeq > 0 && !!oldest && oldest.seq > sinceSeq + 1;

    // Lấy limit+1 để biết còn nữa không (hasMore) mà khỏi query count riêng.
    const rows = await this.changeEventModel
      .find({ user_id: userId, seq: { $gt: sinceSeq } })
      .sort({ seq: 1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const events = page.map((r) => {
      const createdAt = (r as { createdAt?: Date }).createdAt;
      return {
        seq: r.seq,
        type: r.type,
        roomId: r.room_id?.toString() ?? '',
        payloadJson: JSON.stringify(r.payload ?? {}),
        createdAt: createdAt instanceof Date ? createdAt.toISOString() : '',
      };
    });
    const nextSeq = events.length ? events[events.length - 1].seq : sinceSeq;

    // `currentSeq` = giá trị seq toàn cục hiện tại (Redis CHANGE_SEQ). Client
    // dùng để đặt con trỏ sau cold-start. KHÔNG fallback về `nextSeq`: client
    // probe bằng sinceSeq cực lớn (MAX_SAFE_INTEGER) để lấy mốc → khi đó
    // nextSeq = sinceSeq cực lớn; nếu CHANGE_SEQ đọc rỗng mà fallback nextSeq sẽ
    // "đầu độc" con trỏ client = MAX → catch-up pull rỗng vĩnh viễn. Thiếu → 0.
    let currentSeq = 0;
    try {
      const raw = await this.redis.client.get(REDISKEY.CHANGE_SEQ());
      const parsed = Number(raw);
      currentSeq = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      currentSeq = 0;
    }

    // `mayHavePending`: batch rỗng NHƯNG consumer outbox ĐANG LAG (đã cấp seq
    // nhưng CHƯA ghi xong) → có thể có event của user này đang kẹt → client
    // RETRY-có-backoff thay vì "chốt sổ" hụt tin (race pointer out-of-sync).
    // So `currentSeq` (đã cấp) với `writtenSeq` (đã ghi) — KHÔNG so với `nextSeq`
    // của user (sai vì seq toàn cục → luôn > nextSeq do event người khác →
    // false-positive). Đã ghi đủ (written>=current) → KHÔNG retry.
    let writtenSeq = 0;
    try {
      const raw = await this.redis.client.get(REDISKEY.CHANGE_WRITTEN_SEQ());
      const parsed = Number(raw);
      writtenSeq = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      writtenSeq = 0;
    }
    // writtenSeq=0 = chưa khởi tạo (vừa deploy / chưa ghi outbox nào) → KHÔNG
    // claim pending (tránh false-positive bootstrap); chỉ xét khi đã có watermark.
    const mayHavePending =
      events.length === 0 &&
      currentSeq > 0 &&
      writtenSeq > 0 &&
      currentSeq > writtenSeq;

    return {
      events,
      nextSeq,
      hasMore,
      requireFullResync,
      currentSeq,
      mayHavePending,
    };
  }
}
