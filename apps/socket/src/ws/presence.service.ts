import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import { socketEvent } from 'libs/dto/src/enum.type';

/**
 * Per-socket alive TTL — must be longer than the FE heartbeat interval +
 * round-trip slack. FE heartbeat fires every 15s, so 45s lets the alive key
 * survive 2-3 missed beats before the cron sweeps it.
 */
const SOCKET_ALIVE_TTL_SECONDS = 45;

export interface PresenceStatus {
  id: string;
  isOnline: boolean;
  onlineAt: string | null;
  lastSeen: string | null;
}

/**
 * Centralized online-presence tracking shared across the chat / call / doc
 * gateways. The previous design tracked presence separately per gateway —
 * with multiple Redis keys (`USER_PRESENCE`, `USER_ONLINE`, heartbeat zset)
 * that drifted out of sync when a user connected via /chat but disconnected
 * /call (or vice versa), causing stale "online" badges and missed offline
 * broadcasts.
 *
 * New invariants:
 *   - A user is online IFF `USER_ONLINE(userId)` set has at least one
 *     member. Members are `<ns>:<socketId>` strings.
 *   - Each socket has its own TTL via `SOCKET_ALIVE(ns, sid)`. Heartbeat
 *     refreshes it; cron sweeps dead entries.
 *   - STATUS broadcasts only fire on TRANSITIONS (0 → ≥1 online, ≥1 → 0
 *     offline). No noisy spam when a user opens a 2nd tab.
 */
@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly logger = new Logger(PresenceService.name);
  private readonly key = REDISKEY;

  /**
   * The /chat namespace server. Set once during bootstrap (after the chat
   * gateway is constructed) so every namespace can broadcast STATUS through
   * the same channel. FE only listens to `/chat` for status — doing it this
   * way avoids forcing every client to subscribe to /call too.
   */
  private chatServer: Server | null = null;

  constructor(
    @Inject(forwardRef(() => RedisService))
    private readonly redis: RedisService,
  ) {}

  /** Bind the chat namespace server. Called once from ChatGateway.onModuleInit. */
  setChatServer(server: Server) {
    this.chatServer = server;
  }

  /**
   * One-shot startup sweep. Cleans up legacy entries left behind by older
   * deployments — most notably presence sets that stored bare user IDs
   * (Mongo `_id`) as members instead of the current `<ns>:<socketId>`
   * format. Without this, a fresh boot can show users as "online" forever
   * (sCard > 0) until the next cron tick. Runs synchronously during init
   * so the very first inbound `USERSATUS` query gets a clean answer.
   */
  async onModuleInit() {
    try {
      const result = await this.cleanup();
      this.logger.log(
        `[PRESENCE-INIT] startup cleanup: checked=${result.checked} pruned=${result.pruned} offline=${result.offline}`,
      );
    } catch (err) {
      this.logger.warn(
        `[PRESENCE-INIT] startup cleanup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private socketMember(ns: string, socketId: string) {
    return `${ns}:${socketId}`;
  }

  /**
   * Register a connected socket. Returns whether the user just transitioned
   * from offline → online (so the gateway can decide whether to broadcast).
   *
   * `usrId` is the FE-facing identifier (ULID, Users.usr_id) — also what
   * other clients use to query presence. The internal Mongo _id isn't used
   * here on purpose: presence has nothing to do with relational joins.
   */
  async register(
    ns: string,
    socketId: string,
    usrId: string,
  ): Promise<{ wasOffline: boolean }> {
    const member = this.socketMember(ns, socketId);
    const onlineKey = this.key.USER_ONLINE(usrId);

    // Self-clean BEFORE counting — drops legacy members (bare userId from
    // pre-refactor code) and members whose `SOCKET_ALIVE` has expired.
    // Without this, a re-login finds `before > 0` from stale entries and
    // skips the 0→1 broadcast, so other clients never get notified.
    const purged = await this.purgeStaleMembers(onlineKey);
    if (purged > 0) {
      this.logger.log(
        `[PRESENCE-REGISTER] purged ${purged} stale members for ${usrId}`,
      );
    }

    // Snapshot count BEFORE adding so we can detect the 0→1 transition.
    const before = await this.redis.sCard(onlineKey);

    await this.redis.sAdd(onlineKey, member);
    await this.redis.setData(
      this.key.SOCKET_ALIVE(ns, socketId),
      '1',
      SOCKET_ALIVE_TTL_SECONDS,
    );
    await this.redis.setData(
      this.key.USER_LAST_SEEN(usrId),
      new Date().toISOString(),
    );

    const wasOffline = before === 0;
    if (wasOffline) {
      this.broadcastStatus(usrId, true);
    }
    return { wasOffline };
  }

  /**
   * Drop members that don't follow `<ns>:<socketId>` shape OR whose
   * SOCKET_ALIVE TTL has expired. Returns how many were removed. Cheap
   * per-user pass — uses sMembers + a single sRem batch.
   */
  private async purgeStaleMembers(onlineKey: string): Promise<number> {
    const members = await this.redis.sMembers(onlineKey);
    if (members.length === 0) return 0;
    const { dead } = await this.collectDeadMembers(members);
    if (dead.length === 0) return 0;
    await this.redis.sRem(onlineKey, ...dead);
    return dead.length;
  }

  /**
   * Phân loại member của 1 online-set thành dead (legacy/malformed hoặc
   * SOCKET_ALIVE đã hết hạn). Gộp toàn bộ kiểm tra SOCKET_ALIVE vào MỘT `mget`
   * thay vì N lần `getData` tuần tự — quan trọng khi user nhiều socket / online
   * lớn. Chỉ cần biết key còn tồn tại (non-null) là còn sống.
   */
  private async collectDeadMembers(
    members: string[],
  ): Promise<{ dead: string[] }> {
    const dead: string[] = [];
    const toCheck: { member: string; key: string }[] = [];
    for (const m of members) {
      const idx = m.indexOf(':');
      if (idx <= 0 || idx === m.length - 1) {
        dead.push(m); // legacy bare-id or malformed entry
        continue;
      }
      toCheck.push({
        member: m,
        key: this.key.SOCKET_ALIVE(m.slice(0, idx), m.slice(idx + 1)),
      });
    }
    if (toCheck.length > 0) {
      const alive = await this.redis.mget(toCheck.map((t) => t.key));
      toCheck.forEach((t, i) => {
        if (alive[i] === null) dead.push(t.member);
      });
    }
    return { dead };
  }

  /**
   * Unregister a disconnected socket. Returns whether the user just
   * transitioned from online → offline.
   */
  async unregister(
    ns: string,
    socketId: string,
    usrId: string,
  ): Promise<{ wentOffline: boolean }> {
    const member = this.socketMember(ns, socketId);
    const onlineKey = this.key.USER_ONLINE(usrId);

    await this.redis.sRem(onlineKey, member);
    await this.redis.delKey(this.key.SOCKET_ALIVE(ns, socketId));

    const remaining = await this.redis.sCard(onlineKey);
    if (remaining === 0) {
      await this.redis.setData(
        this.key.USER_LAST_SEEN(usrId),
        new Date().toISOString(),
      );
      this.broadcastStatus(usrId, false);
      return { wentOffline: true };
    }
    return { wentOffline: false };
  }

  /** Refresh per-socket TTL. Called on heartbeat. */
  async heartbeat(ns: string, socketId: string, usrId: string): Promise<void> {
    await this.redis.setData(
      this.key.SOCKET_ALIVE(ns, socketId),
      '1',
      SOCKET_ALIVE_TTL_SECONDS,
    );
    // Re-add the member in case the cron pruned it during a network blip.
    // sAdd is a no-op when the member already exists, so this is cheap.
    await this.redis.sAdd(
      this.key.USER_ONLINE(usrId),
      this.socketMember(ns, socketId),
    );
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.sCard(this.key.USER_ONLINE(userId))) > 0;
  }

  /**
   * Bulk presence query. Returns one entry per requested userId so the FE
   * can apply the result wholesale (no need to merge across multiple events).
   */
  async getBulkStatus(userIds: string[]): Promise<PresenceStatus[]> {
    if (userIds.length === 0) return [];

    // SCARD không gộp được bằng mget → dồn vào MỘT pipeline (1 round-trip).
    const cardPipe = this.redis.client.pipeline();
    for (const id of userIds) cardPipe.scard(this.key.USER_ONLINE(id));
    const cardRes = await cardPipe.exec();

    // USER_LAST_SEEN dồn vào MỘT mget (1 round-trip) thay vì N getData.
    const lastSeenRaw = await this.redis.mget(
      userIds.map((id) => this.key.USER_LAST_SEEN(id)),
    );

    const nowIso = new Date().toISOString();
    return userIds.map((id, i) => {
      const card = Number(cardRes?.[i]?.[1] ?? 0);
      const raw = lastSeenRaw[i];
      const lastSeenStr =
        typeof raw === 'string' && raw.startsWith('"')
          ? (JSON.parse(raw) as string)
          : raw;
      const isOnline = card > 0;
      return {
        id,
        isOnline,
        onlineAt: isOnline ? lastSeenStr || nowIso : null,
        lastSeen: lastSeenStr || null,
      };
    });
  }

  /**
   * Cleanup pass — invoked by cron. Walks every `chat:user:*:online` set,
   * inspects each member's `SOCKET_ALIVE` key, removes dead members, and
   * broadcasts offline if the set drops to empty.
   */
  async cleanup(): Promise<{ checked: number; pruned: number; offline: number }> {
    const pattern = 'chat:user:*:online';
    let cursor = '0';
    let checked = 0;
    let pruned = 0;
    let offline = 0;
    do {
      const result = await this.redis.scan(cursor, pattern, 200);
      cursor = result.cursor;
      for (const key of result.keys) {
        // key is `chat:user:<userId>:online`
        const userId = this.extractUserIdFromOnlineKey(key);
        if (!userId) continue;
        checked += 1;
        // Lấy members 1 lần; suy ra before/after từ độ dài thay vì 2 SCARD.
        const members = await this.redis.sMembers(key);
        const before = members.length;
        if (before === 0) continue;
        // Gộp kiểm tra SOCKET_ALIVE vào 1 mget (xem collectDeadMembers).
        const { dead } = await this.collectDeadMembers(members);
        if (dead.length > 0) {
          await this.redis.sRem(key, ...dead);
          pruned += dead.length;
        }
        const after = before - dead.length;
        if (before > 0 && after === 0) {
          await this.redis.setData(
            this.key.USER_LAST_SEEN(userId),
            new Date().toISOString(),
          );
          // Best-effort broadcast: if we don't know usr_id (only have _id),
          // emit with userId as id. The FE reconciles by either field.
          this.broadcastStatus(userId, false);
          offline += 1;
        }
      }
    } while (cursor !== '0');
    return { checked, pruned, offline };
  }

  private extractUserIdFromOnlineKey(key: string): string | null {
    // chat:user:<userId>:online
    const m = /^chat:user:(.+):online$/.exec(key);
    return m ? m[1] : null;
  }

  private broadcastStatus(usrId: string, isOnline: boolean) {
    if (!this.chatServer) {
      this.logger.warn(
        '[PRESENCE] chatServer not bound, dropping STATUS broadcast',
      );
      return;
    }
    const payload: PresenceStatus = {
      id: usrId,
      isOnline,
      onlineAt: isOnline ? new Date().toISOString() : null,
      lastSeen: isOnline ? null : new Date().toISOString(),
    };
    this.chatServer.to('system').emit(socketEvent.STATUS, payload);
  }
}
