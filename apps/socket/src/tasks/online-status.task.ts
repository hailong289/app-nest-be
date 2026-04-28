import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PresenceService } from '../ws/presence.service';

/**
 * Periodic sweeper for stale presence state. Runs every 30s and asks the
 * PresenceService to walk every `chat:user:*:online` set, drop members
 * whose `SOCKET_ALIVE` key has expired (heartbeat stopped 45s+ ago), and
 * broadcast offline transitions.
 *
 * Why a cron at all? Disconnect handlers cover the happy path, but if the
 * Node process crashes mid-disconnect or the client drops without a clean
 * close (closed laptop lid, network blackhole), the only signal left is
 * the heartbeat going silent — that's what this task catches.
 */
@Injectable()
export class OnlineStatusTask {
  private readonly logger = new Logger(OnlineStatusTask.name);

  constructor(private readonly presence: PresenceService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleOnlineStatus() {
    const { checked, pruned, offline } = await this.presence.cleanup();
    if (pruned > 0 || offline > 0) {
      this.logger.log(
        `[PRESENCE-CRON] checked=${checked} pruned=${pruned} offline=${offline}`,
      );
    }
  }
}
