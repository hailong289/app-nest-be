import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RoomsUsersState } from 'libs/db/src';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import Utils from '@app/helpers/utils';

/**
 * Flush unread Redis → Mongo theo lô.
 *
 * Unread sống ở Redis (hot-path HINCRBY) cho throughput cao; Mongo chỉ giữ bản
 * "xấp xỉ gần nhất" làm fallback khi Redis lạnh. Mỗi chu kỳ đọc set "dirty"
 * (các cặp userId:roomMongoId thay đổi), lấy count hiện tại trong Redis và ghi
 * SET tuyệt đối vào `RoomsUsersState.unread_count` theo bulkWrite — idempotent.
 *
 * Lưu ý multi-instance: ghi SET tuyệt đối nên chạy trùng vô hại (có thể thêm
 * Redis lock sau nếu cần). `running` guard tránh chồng chu kỳ trong 1 instance.
 */
@Injectable()
export class UnreadFlushService {
  private readonly logger = new Logger(UnreadFlushService.name);
  private readonly key = REDISKEY;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    @InjectModel(RoomsUsersState.name)
    private readonly roomsUsersState: Model<RoomsUsersState>,
  ) {}

  @Interval(20000)
  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const dirtyKey = this.key.UNREAD_DIRTY();
      const members = await this.redis.sMembers(dirtyKey);
      if (members.length === 0) return;

      // group roomMongoId theo userId để mỗi user chỉ HGETALL 1 lần.
      const byUser = new Map<string, string[]>();
      for (const m of members) {
        const idx = m.indexOf(':');
        if (idx < 0) continue;
        const userId = m.slice(0, idx);
        const roomId = m.slice(idx + 1);
        const arr = byUser.get(userId);
        if (arr) arr.push(roomId);
        else byUser.set(userId, [roomId]);
      }

      const ops: Parameters<Model<RoomsUsersState>['bulkWrite']>[0] = [];
      for (const [userId, roomIds] of byUser) {
        const hash = await this.redis.hGetAll(this.key.UNREAD(userId));
        const uid = Utils.convertToObjectIdMongoose(userId);
        for (const roomId of roomIds) {
          const count = Number(hash[roomId] ?? 0) || 0;
          ops.push({
            updateOne: {
              filter: {
                room_id: Utils.convertToObjectIdMongoose(roomId),
                user_id: uid,
              },
              update: { $set: { unread_count: count } },
            },
          });
        }
      }

      const CHUNK = 500;
      for (let i = 0; i < ops.length; i += CHUNK) {
        await this.roomsUsersState.bulkWrite(ops.slice(i, i + CHUNK), {
          ordered: false,
        });
      }

      // Xoá các cặp đã flush khỏi dirty (lô vừa xử lý). Tăng mới xảy ra sau sẽ
      // SADD lại cặp tương ứng nên không mất; ghi SET tuyệt đối nên không lệch.
      const CHUNK_SREM = 500;
      for (let i = 0; i < members.length; i += CHUNK_SREM) {
        await this.redis.sRem(dirtyKey, ...members.slice(i, i + CHUNK_SREM));
      }

      this.logger.log(
        `[UNREAD_FLUSH] flushed ${ops.length} entries (${byUser.size} users)`,
      );
    } catch (err) {
      this.logger.error(
        `[UNREAD_FLUSH] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
