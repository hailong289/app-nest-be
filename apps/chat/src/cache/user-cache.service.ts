import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { firstValueFrom } from 'rxjs';

// ── Interfaces ──────────────────────────────────────────────────────────────

/** Raw User shape returned by Auth gRPC service (auth.proto -> User message). */
export interface GrpcUser {
  _id: string;
  id: string;
  fullname: string;
  slug: string;
  email: string;
  phone: string;
  avatar: string;
  gender: string;
  dateOfBirth: string;
  createdAt: string;
  updatedAt: string;
  // Allow additional fields that the proto may carry
  [key: string]: any;
}

interface AuthGrpcClient {
  GetUserById(data: { userId: string }): any;
  GetUsersByIds(data: { userIds: string[] }): any;
}

type GrpcListResponse<T> = { metadata?: T[] };

// ── Cache entry ─────────────────────────────────────────────────────────────

interface CacheEntry {
  data: GrpcUser;
  expiresAt: number;
}

interface CacheStats {
  requests: number;
  requestedUserIds: number;
  memoryHits: number;
  redisHits: number;
  grpcLookups: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MEMORY_TTL_MS = 60_000;          // 60 seconds for in-memory
const MAX_MEMORY_ENTRIES = 10_000;     // maximum in-memory cache size
const REDIS_TTL_SEC = 300;             // 5 minutes for Redis
const REDIS_KEY_PREFIX = 'USER_INFO:'; // Redis key prefix
const CLEANUP_INTERVAL_MS = 60_000;    // Run eviction every 60 seconds

@Injectable()
export class UserCacheService implements OnModuleInit {
  private readonly logger = new Logger(UserCacheService.name);
  private authGrpcClient: AuthGrpcClient;

  /** In-memory LRU cache: userId -> { data, expiresAt } */
  private readonly cache = new Map<string, CacheEntry>();
  private readonly stats: CacheStats = {
    requests: 0,
    requestedUserIds: 0,
    memoryHits: 0,
    redisHits: 0,
    grpcLookups: 0,
  };

  constructor(
    @Inject(SERVICES.AUTH) private readonly authGrpc: ClientGrpc,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');

    // Periodic cleanup of expired in-memory entries
    setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Batch fetch users by IDs with two-tier caching:
   *   Tier 1: In-memory LRU (60s TTL, 10k max)
   *   Tier 2: Redis (5min TTL)
   *   Tier 3: gRPC fallback (auth service, source of truth)
   *
   * Returns raw gRPC User objects. Callers map fields as needed.
   *
   * Gracefully degrades: if Redis is unavailable, falls through to gRPC.
   * If gRPC fails, returns whatever was found in caches (possibly empty).
   */
  async getUsersByIdsCached(userIds: string[]): Promise<GrpcUser[]> {
    if (!userIds.length) return [];

    this.stats.requests += 1;
    this.stats.requestedUserIds += userIds.length;

    const result: GrpcUser[] = [];
    const redisCheck: string[] = [];

    // ── Tier 1: In-memory cache ──────────────────────────────────────────
    for (const id of userIds) {
      const entry = this.cache.get(id);
      if (entry && entry.expiresAt > Date.now()) {
        result.push(entry.data);
        this.stats.memoryHits += 1;
      } else {
        redisCheck.push(id);
      }
    }

    if (redisCheck.length === 0) return result;

    // ── Tier 2: Redis cache ──────────────────────────────────────────────
    const redisKeys = redisCheck.map((id) => `${REDIS_KEY_PREFIX}${id}`);
    let redisRaw: (string | null)[];

    try {
      redisRaw = await this.redis.mget(redisKeys);
    } catch {
      // Redis unavailable — skip straight to gRPC for all
      redisRaw = redisKeys.map(() => null);
    }

    const grpcLookup: string[] = [];

    for (let i = 0; i < redisCheck.length; i++) {
      const userId = redisCheck[i];
      const raw = redisRaw[i];
      if (raw) {
        try {
          const parsed: GrpcUser = JSON.parse(raw);
          // Restore in in-memory cache (LRU with fresh TTL)
          this.setInMemory(userId, parsed);
          result.push(parsed);
          this.stats.redisHits += 1;
        } catch {
          // Corrupt JSON — fall through to gRPC
          grpcLookup.push(userId);
        }
      } else {
        grpcLookup.push(userId);
      }
    }

    if (grpcLookup.length === 0) return result;

    // ── Tier 3: gRPC (source of truth) ───────────────────────────────────
    this.stats.grpcLookups += grpcLookup.length;
    try {
      const grpcResult = await firstValueFrom(
        this.authGrpcClient.GetUsersByIds({ userIds: grpcLookup }),
      );
      const grpcUsers: GrpcUser[] =
        (grpcResult as GrpcListResponse<GrpcUser>)?.metadata ?? [];

      // Populate both caches with fresh data
      for (const user of grpcUsers) {
        const id = String(user._id);
        this.setInMemory(id, user);
        // Fire-and-forget Redis write — non-fatal if Redis is down
        this.setRedis(id, user).catch(() => {});
        result.push(user);
      }
    } catch (err) {
      this.logger.error('gRPC GetUsersByIds failed', err instanceof Error ? err.message : err);
      // Return whatever we managed to collect from caches so far
    }

    this.logStatsPeriodically();
    return result;
  }

  /**
   * Runtime stats for verification/benchmarking cache hit ratio.
   */
  getStats() {
    const hitCount = this.stats.memoryHits + this.stats.redisHits;
    const requested = this.stats.requestedUserIds || 1;
    return {
      ...this.stats,
      hitCount,
      hitRatio: hitCount / requested,
    };
  }

  resetStats(): void {
    this.stats.requests = 0;
    this.stats.requestedUserIds = 0;
    this.stats.memoryHits = 0;
    this.stats.redisHits = 0;
    this.stats.grpcLookups = 0;
  }

  /**
   * Convenience method: fetch a single user by ID.
   * Uses the same two-tier caching as the batch variant.
   */
  async getUserByIdCached(userId: string): Promise<GrpcUser | null> {
    const users = await this.getUsersByIdsCached([userId]);
    return users[0] ?? null;
  }

  /**
   * Invalidate a specific user from both caches.
   * Useful after profile updates to force a fresh fetch.
   */
  invalidateUser(userId: string): void {
    this.cache.delete(userId);
    // Fire-and-forget Redis deletion
    this.redis
      .delKey(`${REDIS_KEY_PREFIX}${userId}`)
      .catch(() => {});
  }

  /**
   * Clear all in-memory cache entries.
   * Note: Redis entries are not cleared in bulk (they expire naturally via TTL).
   * If immediate Redis invalidation is required, use SCAN + DEL externally.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Store a user in the in-memory cache.
   * If at capacity, evicts the oldest entry (Map insertion order).
   */
  private setInMemory(userId: string, data: GrpcUser): void {
    if (this.cache.size >= MAX_MEMORY_ENTRIES) {
      // Map preserves insertion order — first key is the oldest
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(userId, {
      data,
      expiresAt: Date.now() + MEMORY_TTL_MS,
    });
  }

  /** Store a user in Redis with TTL. Failures are silently swallowed. */
  private async setRedis(userId: string, data: GrpcUser): Promise<void> {
    await this.redis.setData(
      `${REDIS_KEY_PREFIX}${userId}`,
      data,
      REDIS_TTL_SEC,
    );
  }

  /** Evict expired entries from the in-memory cache. */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.debug(`Evicted ${evicted} expired entries from in-memory cache`);
    }
  }

  private logStatsPeriodically(): void {
    if (this.stats.requests % 50 !== 0) return;
    const s = this.getStats();
    this.logger.log(
      `cache stats: requests=${s.requests}, userIds=${s.requestedUserIds}, hits=${s.hitCount}, hitRatio=${(s.hitRatio * 100).toFixed(1)}%, grpcLookups=${s.grpcLookups}`,
    );
  }
}
