import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import { ChangeFeedService } from './change-feed.service';

/**
 * Cap mềm change-feed: định kỳ giữ tối đa `CHANGEFEED_MAX_PER_USER` event/user,
 * xoá phần cũ vượt ngưỡng. Chỉ xử lý user "dirty" (vừa có outbox ghi) đọc từ
 * `CHANGEFEED_DIRTY` — khỏi quét toàn collection. TTL `expireAt` lo phần thời
 * gian; job này lo phần dung lượng cho user siêu hoạt động. Xem
 * plan/DONG_BO_EVENT_SYNC.md (5a). Cùng pattern với UnreadFlushService.
 */
@Injectable()
export class ChangeFeedTrimService {
  private readonly logger = new Logger(ChangeFeedTrimService.name);
  private readonly key = REDISKEY;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly changeFeed: ChangeFeedService,
  ) {}

  @Interval(5 * 60 * 1000) // mỗi 5 phút
  async trim(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const dirtyKey = this.key.CHANGEFEED_DIRTY();
      const users = await this.redis.sMembers(dirtyKey);
      if (users.length === 0) return;

      let totalDeleted = 0;
      for (const userId of users) {
        try {
          totalDeleted += await this.changeFeed.trimUserToCap(userId);
        } catch (err) {
          this.logger.error(
            `[CHANGEFEED_TRIM] user ${userId} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Xoá user đã xử lý khỏi dirty. Outbox ghi sau sẽ SADD lại nên không mất;
      // trim idempotent nên bỏ sót 1 chu kỳ cũng vô hại.
      const CHUNK = 500;
      for (let i = 0; i < users.length; i += CHUNK) {
        await this.redis.sRem(dirtyKey, ...users.slice(i, i + CHUNK));
      }

      if (totalDeleted > 0) {
        this.logger.log(
          `[CHANGEFEED_TRIM] trimmed ${totalDeleted} events across ${users.length} users`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[CHANGEFEED_TRIM] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
