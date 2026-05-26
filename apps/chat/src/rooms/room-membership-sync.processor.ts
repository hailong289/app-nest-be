import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { REDISKEY } from '@app/constants/RedisKey';
import { RedisService } from 'libs/db/src/redis/redis.service';
import {
  ROOM_MEMBERSHIP_SYNC_QUEUE,
  ROOM_MEMBERSHIP_SYNC_CHUNK,
  type RoomMembershipSyncJobData,
} from './room-membership-sync.constants';

/**
 * Worker xử lý bulk USER_ROOMS sAdd theo lô 50 thành viên một lần.
 *
 * Tại sao 50/lần thay vì 1 pipeline cả mảng:
 *   - Mongoose/Redis client pool có giới hạn — fan-out 1000 sAdd song song
 *     ngay trong request handler đã từng đánh sập service (timeout 20s →
 *     503). 50 là điểm cân bằng: vẫn parallel đủ để tận dụng I/O nhưng
 *     không nuốt hết kết nối, mỗi đợt ~10-30ms ⇒ 1000 user xử lý xong
 *     trong vài trăm ms.
 *   - Giữ đơn vị job đủ nhỏ để retry không quá tốn (nếu 1 chunk fail,
 *     Bull retry chỉ chunk đó — không phải toàn bộ 1000 sAdd).
 *
 * Idempotent: sAdd là set operation, retry không tạo duplicate.
 */
@Processor(ROOM_MEMBERSHIP_SYNC_QUEUE)
export class RoomMembershipSyncProcessor {
  private readonly logger = new Logger(RoomMembershipSyncProcessor.name);
  private readonly key = REDISKEY;

  constructor(private readonly redis: RedisService) {}

  @Process()
  async handle(job: Job<RoomMembershipSyncJobData>): Promise<void> {
    const { roomCustomId, memberIds } = job.data;
    if (!roomCustomId || !memberIds?.length) return;

    const total = memberIds.length;
    let processed = 0;

    for (let i = 0; i < total; i += ROOM_MEMBERSHIP_SYNC_CHUNK) {
      const chunk = memberIds.slice(i, i + ROOM_MEMBERSHIP_SYNC_CHUNK);
      await Promise.all(
        chunk.map((userId) =>
          this.redis.sAdd(this.key.USER_ROOMS(userId), roomCustomId),
        ),
      );
      processed += chunk.length;
    }

    this.logger.log(
      `[ROOM_MEMBERSHIP_SYNC] room=${roomCustomId} synced ${processed}/${total} USER_ROOMS entries`,
    );
  }
}
