import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientKafka } from '@nestjs/microservices';
import { Model, Types } from 'mongoose';
import { UserChangeEvent } from 'libs/db/src';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { SERVICES } from '@app/constants';
import { REDISKEY } from '@app/constants/RedisKey';
import { ChangeEventType, KafkaEvent } from '@app/dto/enum.type';
import Utils from '@app/helpers/utils';

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
export class ChangeFeedService {
  private readonly logger = new Logger(ChangeFeedService.name);

  constructor(
    @InjectModel(UserChangeEvent.name)
    private readonly changeEventModel: Model<UserChangeEvent>,
    @Inject(SERVICES.CHAT)
    private readonly chatClient: ClientKafka,
    private readonly redis: RedisService,
  ) {}

  /**
   * Cấp `seq` rồi phát event để consumer ghi outbox. Trả `seq` để caller (vd
   * createMessage) gắn cùng giá trị vào payload realtime. No-op nếu không có
   * recipient.
   */
  async emit(params: {
    type: ChangeEventType;
    roomId: string;
    recipients: string[];
    payload: Record<string, unknown>;
  }): Promise<number> {
    const { type, roomId, recipients, payload } = params;
    if (!recipients?.length) return 0;

    const seq = await this.redis.incrPersist(REDISKEY.CHANGE_SEQ());
    await Utils.dispatchEventKafka(this.chatClient, KafkaEvent.OUTBOX_APPEND, {
      seq,
      type,
      roomId,
      recipients,
      payload,
    } satisfies OutboxAppendPayload);
    return seq;
  }

  /**
   * Consumer `OUTBOX_APPEND`: ghi 1 row/recipient. `room.newmsgs` upsert HWM
   * theo `{user_id, room_id, type}` (mỗi user-phòng chỉ 1 high-water-mark);
   * còn lại insert. `ordered:false` để 1 recipient lỗi không chặn phần còn lại.
   */
  async handleOutboxAppend(data: OutboxAppendPayload): Promise<void> {
    const { seq, type, roomId, recipients, payload } = data;
    if (!recipients?.length) return;

    const roomObjId = Utils.convertToObjectIdMongoose(roomId);
    const isHwm = type === ChangeEventType.ROOM_NEWMSGS;

    const ops = recipients.map((uid) => {
      const user_id = new Types.ObjectId(uid);
      if (isHwm) {
        return {
          updateOne: {
            filter: { user_id, room_id: roomObjId, type },
            update: { $set: { seq, payload } },
            upsert: true,
          },
        };
      }
      return {
        insertOne: {
          document: { user_id, room_id: roomObjId, type, seq, payload },
        },
      };
    });

    await this.changeEventModel.bulkWrite(ops, { ordered: false });
  }
}
