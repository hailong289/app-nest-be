import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { LruMap } from './lru-map';
import {
  CACHE_INVALIDATE_CHANNEL,
  CacheInvalidateMessage,
  indexKey,
} from './cache.keys';

export interface GetOrLoadOptions<T = unknown> {
  /** Namespace của entity (vd 'user', 'room') — dùng cho reverse-index. */
  ns: string;
  /** Id canonical của entity (vd Mongo _id dạng chuỗi) — gom mọi alias key. */
  entityId: string;
  /** TTL L2 (giây). Mặc định REDIS_TTL.CACHE_ENTITY = 1800. */
  ttlSec?: number;
  /**
   * Nếu cung cấp: sau khi loader trả doc, đăng ký cache key vào reverse-index
   * theo CÁC id canonical lấy từ chính doc (vd [room._id, room.room_id]) thay
   * vì theo `entityId`. Đảm bảo invalidateEntity(ns, <canonical id>) luôn xoá
   * được entry kể cả khi key được tra bằng alias khác (vd peer id của phòng
   * private). Trả mảng id (chuỗi).
   */
  indexIds?: (value: T) => string[];
}

const DEFAULT_L2_TTL_SEC = 1800;
const L1_MAX_SIZE = 10_000;
const L1_TTL_MS = 60_000;

/**
 * Cache 2 tầng generic cho document ít thay đổi.
 *   L1: LruMap trong RAM mỗi instance (TTL ngắn, tự lành).
 *   L2: Redis qua RedisService (TTL dài, chia sẻ giữa các service).
 *   pub/sub: drop L1 trên mọi instance khi invalidate (wiring ở Task 6).
 *
 * Không bao giờ throw — Redis lỗi thì fallback gọi loader (degrade về
 * hành vi truy vấn Mongo trực tiếp).
 */
@Injectable()
export class EntityCacheService implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis | null = null;
  private readonly log = new Logger(EntityCacheService.name);
  private readonly l1 = new LruMap<unknown>({
    maxSize: L1_MAX_SIZE,
    ttlMs: L1_TTL_MS,
  });

  constructor(private readonly redis: RedisService) {}

  /** Thời gian hiện tại (ms) — tách ra để test override nếu cần. */
  protected now(): number {
    return Date.now();
  }

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    opts: GetOrLoadOptions<T>,
  ): Promise<T | null> {
    // L1
    const l1Hit = this.l1.get(key, this.now());
    if (l1Hit !== undefined) return l1Hit as T;

    // L2
    const l2Hit = await this.redis.getData<T>(key);
    if (l2Hit !== null && l2Hit !== undefined) {
      this.l1.set(key, l2Hit, this.now());
      return l2Hit;
    }

    // Miss cả hai -> loader (Mongo)
    const loaded = await loader();
    if (loaded === null || loaded === undefined) return loaded ?? null;

    const ttl = opts.ttlSec ?? DEFAULT_L2_TTL_SEC;
    const ids = opts.indexIds ? opts.indexIds(loaded) : [opts.entityId];
    await this.redis.setData(key, loaded, ttl);
    await Promise.all(
      ids.map(async (id) => {
        const idx = indexKey(opts.ns, id);
        await this.redis.sAdd(idx, key);
        await this.redis.expire(idx, ttl);
      }),
    );
    this.l1.set(key, loaded, this.now());
    return loaded;
  }

  /**
   * Xoá mọi alias key của entity ở L2 + broadcast để mọi instance drop L1.
   */
  async invalidateEntity(ns: string, entityId: string): Promise<void> {
    const idx = indexKey(ns, entityId);
    const keys = await this.redis.sMembers(idx);
    await Promise.all(keys.map((k) => this.redis.delKey(k)));
    for (const k of keys) this.l1.delete(k);
    await this.redis.delKey(idx);
    if (keys.length > 0) {
      const msg: CacheInvalidateMessage = { keys };
      await this.redis.publish(CACHE_INVALIDATE_CHANNEL, JSON.stringify(msg));
    }
  }

  /** Dùng bởi subscriber (Task 6) để drop L1 khi nhận broadcast. */
  dropFromL1(keys: string[]): void {
    for (const k of keys) this.l1.delete(k);
  }

  /** Xoá sạch L1 — gọi khi subscriber reconnect (có thể đã miss invalidation). */
  flushL1(): void {
    this.l1.clear();
  }

  onModuleInit(): void {
    try {
      this.subscriber = this.redis.client.duplicate();
      this.subscriber.subscribe(CACHE_INVALIDATE_CHANNEL, (err) => {
        if (err) this.log.error(`subscribe failed: ${err.message}`);
      });
      this.subscriber.on('message', (channel: string, raw: string) => {
        if (channel !== CACHE_INVALIDATE_CHANNEL) return;
        try {
          const msg = JSON.parse(raw) as CacheInvalidateMessage;
          if (Array.isArray(msg.keys)) this.dropFromL1(msg.keys);
        } catch (e) {
          this.log.error(`bad invalidate payload: ${String(e)}`);
        }
      });
      // Reconnect có thể đã bỏ lỡ invalidation -> flush sạch L1 cho an toàn.
      this.subscriber.on('ready', () => this.flushL1());
    } catch (e) {
      this.log.error(`cannot init cache subscriber: ${String(e)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscriber?.quit();
    } catch {
      // ignore
    }
  }
}
