import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from 'libs/db/src';
import { ChatGateway } from '../chat/chat-gateway';
import { REDISKEY, REDIS_TTL } from '@app/constants/RedisKey';
import { socketEvent } from 'libs/dto/src/enum.type';

@Injectable()
export class OnlineStatusTask {
  private readonly logger = new Logger(OnlineStatusTask.name);
  private readonly key = REDISKEY;

  constructor(
    private readonly redis: RedisService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Chạy mỗi 30 giây để kiểm tra user nào đã "hết hạn" heartbeat.
   * Nếu user không gửi heartbeat trong khoảng (REDIS_TTL.ONLINE_STATUS + buffer), coi như offline.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleOnlineStatus() {
    // this.logger.debug('Checking online status...');
    const now = Date.now();
    // Timeout = TTL (30s) + Buffer (15s) = 45s (45000ms)
    // User nào có score < (now - 45000) tức là đã expire
    const timeout = (REDIS_TTL.ONLINE_STATUS + 15) * 1000;
    const maxScore = now - timeout;

    // Lấy danh sách user hết hạn
    const expiredUsers = await this.redis.zRangeByScore(
      this.key.USERS_HEARTBEAT,
      '-inf',
      maxScore,
    );

    if (expiredUsers.length > 0) {
      this.logger.log(`Found ${expiredUsers.length} expired users.`);

      // Xóa khỏi ZSET
      await this.redis.zRem(this.key.USERS_HEARTBEAT, ...expiredUsers);

      // Broadcast offline status
      for (const userId of expiredUsers) {
        // Xóa key chi tiết của user (optional, vì key này có TTL rồi nhưng xóa cho sạch)
        await this.redis.delKey(this.key.USER_ONLINE(userId));

        // Emit offline event via Gateway
        // Lưu ý: GateWay function cần public
        this.chatGateway.server.to('system').emit(socketEvent.STATUS, {
          id: userId, // userId ở đây là members trong ZSET (mong là userId string)
          isOnline: false,
          lastSeen: new Date(),
        });

        // Cập nhật last seen
        await this.redis.setData(
          this.key.USER_LAST_SEEN(userId),
          new Date().toISOString(),
        );
      }
    }
  }
}
