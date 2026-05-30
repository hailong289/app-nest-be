# Room & User Two-Tier Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loại bỏ phần lớn query Mongo lặp lại cho room & user (đang làm treo DB ở load test 10k user) bằng một lớp cache 2 tầng L1(RAM)+L2(Redis)+pub/sub, dùng chung cho `auth` và `chat`.

**Architecture:** `EntityCacheService` generic trong `libs/db` (provide `@Global`): L1 là một LRU Map có soft-TTL trong RAM mỗi instance; L2 là Redis qua `RedisService` (TTL dài); một connection subscriber riêng nghe kênh `cache:invalidate` để drop L1 trên mọi instance khi data đổi. Hai repository mỏng (`UserCacheRepository` dùng chung trong `libs/db`, `RoomCacheRepository` trong module chat) bọc service này, xử lý alias key qua reverse-index Redis và gọi invalidate ở các điểm ghi.

**Tech Stack:** NestJS, Mongoose, ioredis, Jest + ts-jest.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `libs/db/src/cache/cache.keys.ts` (create) | Hằng số kênh pub/sub + helper dựng cache key & reverse-index key. Tự chứa, không phụ thuộc `@app/constants` để test import quan hệ tương đối. |
| `libs/db/src/cache/lru-map.ts` (create) | LRU Map có per-entry TTL, không phụ thuộc gì → unit test thuần. |
| `libs/db/src/cache/entity-cache.service.ts` (create) | Lõi 2 tầng: `getOrLoad`, `invalidateEntity`, subscriber pub/sub, reconnect flush. |
| `libs/db/src/cache/cache.module.ts` (create) | `@Global` module provide `EntityCacheService`. |
| `libs/db/src/cache/user-cache.repository.ts` (create) | Bọc cache cho User: `getById`, `getByUsrId`, `invalidate`. Dùng chung auth+chat. |
| `libs/db/src/index.ts` (modify) | Export `CacheModule`, `EntityCacheService`, `UserCacheRepository`, cache keys. |
| `libs/constants/src/RedisKey.ts` (modify) | Thêm `REDIS_TTL.CACHE_ENTITY`. |
| `apps/chat/src/rooms/room-cache.repository.ts` (create) | Bọc cache cho Room: `getByRoomId`, `getByPairOrRoomId`, `getById`, `invalidate`. |
| `apps/chat/src/rooms/rooms.module.ts` (modify) | Provide `RoomCacheRepository` + `UserCacheRepository`; export chúng. |
| `apps/chat/src/app.module.ts` (modify) | Import `CacheModule`. |
| `apps/chat/src/rooms/rooms.service.ts` (modify) | `getUserInfo` đọc qua cache; invalidate room ở các điểm ghi room. |
| `apps/chat/src/handle-chat/handle-chat.service.ts` (modify) | Đọc room qua `RoomCacheRepository`; invalidate khi ghim. |
| `apps/auth/src/app.module.ts` (modify) | Import `CacheModule`. |
| `apps/auth/src/auth.module.ts` (modify) | Provide `UserCacheRepository`. |
| `apps/auth/src/auth.service.ts` (modify) | Invalidate user ở `updateProfile`/`updateAvatar`. |
| `package.json` (modify) | Sửa jest config để discover spec ở cả `apps/` và `libs/` + map path alias. |

---

## Task 1: Sửa cấu hình Jest để chạy được unit test ở `libs/` và `apps/`

**Files:**
- Modify: `package.json` (block `"jest"`, dòng ~157-176)

Hiện `rootDir: "apps"` và `roots: ["<rootDir>/apps/"]` (= `apps/apps/`) khiến không spec nào được tìm thấy. Sửa rootDir về gốc repo, roots gồm cả `apps` và `libs`, thêm `moduleNameMapper` cho path alias `@app/*`.

- [ ] **Step 1: Sửa block jest trong `package.json`**

Thay block `"jest": { ... }` hiện tại thành:

```json
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": ".",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": [
      "apps/**/*.(t|j)s",
      "libs/**/*.(t|j)s"
    ],
    "coverageDirectory": "./coverage",
    "testEnvironment": "node",
    "roots": [
      "<rootDir>/apps/",
      "<rootDir>/libs/"
    ],
    "moduleNameMapper": {
      "^@app/constants(|/.*)$": "<rootDir>/libs/constants/src/$1",
      "^@app/dto(|/.*)$": "<rootDir>/libs/dto/src/$1",
      "^@app/helpers(|/.*)$": "<rootDir>/libs/helpers/$1"
    }
  }
```

- [ ] **Step 2: Tạo một smoke test tạm để xác nhận discovery hoạt động**

Create `libs/db/src/cache/__jest_smoke__.spec.ts`:

```ts
describe('jest discovery', () => {
  it('runs specs under libs/', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Chạy và xác nhận PASS**

Run: `npx jest libs/db/src/cache/__jest_smoke__ --silent`
Expected: PASS, 1 test.

- [ ] **Step 4: Xoá smoke test**

```bash
rm libs/db/src/cache/__jest_smoke__.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test: fix jest config to discover specs in apps and libs"
```

---

## Task 2: `LruMap` — Map có giới hạn size (LRU) + per-entry TTL

**Files:**
- Create: `libs/db/src/cache/lru-map.ts`
- Test: `libs/db/src/cache/lru-map.spec.ts`

- [ ] **Step 1: Viết test thất bại**

Create `libs/db/src/cache/lru-map.spec.ts`:

```ts
import { LruMap } from './lru-map';

describe('LruMap', () => {
  it('returns a stored value before it expires', () => {
    const m = new LruMap<number>({ maxSize: 10, ttlMs: 1000 });
    m.set('a', 1, 0);
    expect(m.get('a', 500)).toBe(1);
  });

  it('returns undefined after the entry TTL passes', () => {
    const m = new LruMap<number>({ maxSize: 10, ttlMs: 1000 });
    m.set('a', 1, 0);
    expect(m.get('a', 1001)).toBeUndefined();
  });

  it('evicts the least-recently-used entry when over maxSize', () => {
    const m = new LruMap<number>({ maxSize: 2, ttlMs: 10_000 });
    m.set('a', 1, 0);
    m.set('b', 2, 0);
    m.get('a', 1); // touch 'a' so 'b' becomes LRU
    m.set('c', 3, 1); // exceeds size -> evict 'b'
    expect(m.get('a', 2)).toBe(1);
    expect(m.get('b', 2)).toBeUndefined();
    expect(m.get('c', 2)).toBe(3);
  });

  it('deletes specific keys', () => {
    const m = new LruMap<number>({ maxSize: 10, ttlMs: 1000 });
    m.set('a', 1, 0);
    m.delete('a');
    expect(m.get('a', 1)).toBeUndefined();
  });

  it('clears all entries', () => {
    const m = new LruMap<number>({ maxSize: 10, ttlMs: 1000 });
    m.set('a', 1, 0);
    m.set('b', 2, 0);
    m.clear();
    expect(m.get('a', 1)).toBeUndefined();
    expect(m.get('b', 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest libs/db/src/cache/lru-map --silent`
Expected: FAIL — `Cannot find module './lru-map'`.

- [ ] **Step 3: Hiện thực `LruMap`**

Create `libs/db/src/cache/lru-map.ts`:

```ts
interface LruEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

export interface LruMapOptions {
  maxSize: number;
  ttlMs: number;
}

/**
 * Map có giới hạn kích thước (LRU eviction) và per-entry TTL.
 * Thời gian được truyền vào (`nowMs`) thay vì gọi Date.now() bên trong
 * để dễ test tất định.
 */
export class LruMap<T> {
  private readonly store = new Map<string, LruEntry<T>>();

  constructor(private readonly opts: LruMapOptions) {}

  get(key: string, nowMs: number): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.store.delete(key);
      return undefined;
    }
    // touch: chuyển xuống cuối để đánh dấu mới-dùng-gần-đây
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, nowMs: number): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: nowMs + this.opts.ttlMs });
    while (this.store.size > this.opts.maxSize) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
```

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest libs/db/src/cache/lru-map --silent`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/db/src/cache/lru-map.ts libs/db/src/cache/lru-map.spec.ts
git commit -m "feat(cache): add LruMap with size bound and per-entry TTL"
```

---

## Task 3: `cache.keys.ts` — hằng số kênh + helper dựng key

**Files:**
- Create: `libs/db/src/cache/cache.keys.ts`
- Test: `libs/db/src/cache/cache.keys.spec.ts`

- [ ] **Step 1: Viết test thất bại**

Create `libs/db/src/cache/cache.keys.spec.ts`:

```ts
import { CACHE_INVALIDATE_CHANNEL, cacheKey, indexKey } from './cache.keys';

describe('cache.keys', () => {
  it('exposes a namespaced pub/sub channel name', () => {
    expect(CACHE_INVALIDATE_CHANNEL).toBe('cache:invalidate');
  });

  it('builds an entity cache key from ns, field and value', () => {
    expect(cacheKey('user', '_id', 'abc')).toBe('cache:user:_id:abc');
  });

  it('builds a reverse-index key from ns and entity id', () => {
    expect(indexKey('room', 'r1')).toBe('cache:room:idx:r1');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest libs/db/src/cache/cache.keys --silent`
Expected: FAIL — `Cannot find module './cache.keys'`.

- [ ] **Step 3: Hiện thực**

Create `libs/db/src/cache/cache.keys.ts`:

```ts
/**
 * Tên kênh pub/sub dùng để broadcast invalidation tới mọi instance.
 * LƯU Ý: `keyPrefix` của ioredis KHÔNG áp vào tên kênh pub/sub, nên
 * tên kênh được đặt namespace tường minh ở đây.
 */
export const CACHE_INVALIDATE_CHANNEL = 'cache:invalidate';

/** Khoá cache cho một document, tra theo (namespace, field, value). */
export function cacheKey(ns: string, field: string, value: string): string {
  return `cache:${ns}:${field}:${value}`;
}

/** Khoá reverse-index (Redis SET) chứa mọi cacheKey trỏ tới một entity. */
export function indexKey(ns: string, entityId: string): string {
  return `cache:${ns}:idx:${entityId}`;
}

/** Payload broadcast trên kênh invalidation. */
export interface CacheInvalidateMessage {
  keys: string[];
}
```

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest libs/db/src/cache/cache.keys --silent`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/db/src/cache/cache.keys.ts libs/db/src/cache/cache.keys.spec.ts
git commit -m "feat(cache): add cache key helpers and invalidation channel"
```

---

## Task 4: Thêm hằng số TTL `CACHE_ENTITY`

**Files:**
- Modify: `libs/constants/src/RedisKey.ts` (block `REDIS_TTL`, dòng ~312-326)

- [ ] **Step 1: Thêm field vào `REDIS_TTL`**

Trong object `REDIS_TTL`, ngay sau dòng `CALL_ACTIVE: 8 * 3600,` thêm:

```ts
  // Document cache (room/user) — read-heavy, ít thay đổi. L2 (Redis) giữ
  // bản full doc; L1 (RAM) có TTL ngắn riêng. Pub/sub invalidate khi đổi.
  CACHE_ENTITY: 1800, // 30 phút
```

- [ ] **Step 2: Build kiểm tra type**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: không có lỗi mới liên quan `RedisKey.ts`.

- [ ] **Step 3: Commit**

```bash
git add libs/constants/src/RedisKey.ts
git commit -m "feat(constants): add CACHE_ENTITY ttl for document cache"
```

---

## Task 5: `EntityCacheService` — `getOrLoad` + L1/L2 (chưa pub/sub)

**Files:**
- Create: `libs/db/src/cache/entity-cache.service.ts`
- Test: `libs/db/src/cache/entity-cache.service.spec.ts`

`EntityCacheService` inject `RedisService`. Trong test ta mock `RedisService` bằng object đơn giản. Phần subscriber pub/sub thêm ở Task 6 — Task này chỉ làm đường đọc + ghi index + invalidate phía L2.

- [ ] **Step 1: Viết test thất bại**

Create `libs/db/src/cache/entity-cache.service.spec.ts`:

```ts
import { EntityCacheService } from './entity-cache.service';
import { cacheKey, indexKey } from './cache.keys';

// Mock RedisService: lưu L2 trong Map, ghi lại publish calls.
function makeRedisMock() {
  const store = new Map<string, any>();
  const sets = new Map<string, Set<string>>();
  const published: { channel: string; msg: any }[] = [];
  return {
    store,
    sets,
    published,
    // ioredis raw client chỉ cần cho subscriber (Task 6) — stub duplicate.
    client: { duplicate: () => ({ subscribe: jest.fn(), on: jest.fn(), quit: jest.fn() }) },
    getData: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    setData: jest.fn(async (k: string, v: any) => void store.set(k, v)),
    delKey: jest.fn(async (k: string) => {
      const had = store.delete(k);
      sets.delete(k);
      return had ? 1 : 0;
    }),
    sAdd: jest.fn(async (k: string, ...vals: string[]) => {
      const s = sets.get(k) ?? new Set<string>();
      vals.forEach((v) => s.add(v));
      sets.set(k, s);
      return vals.length;
    }),
    sMembers: jest.fn(async (k: string) => Array.from(sets.get(k) ?? [])),
    expire: jest.fn(async () => 1),
    publish: jest.fn(async (channel: string, msg: any) => {
      published.push({ channel, msg });
      return 1;
    }),
  };
}

describe('EntityCacheService.getOrLoad', () => {
  it('calls loader on cold cache and returns its value', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const loader = jest.fn(async () => ({ id: 'u1', name: 'A' }));

    const out = await svc.getOrLoad(cacheKey('user', '_id', 'u1'), loader, {
      ns: 'user',
      entityId: 'u1',
    });

    expect(out).toEqual({ id: 'u1', name: 'A' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves from L1 without hitting loader or redis on second read', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const loader = jest.fn(async () => ({ id: 'u1' }));
    const key = cacheKey('user', '_id', 'u1');

    await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'u1' });
    redis.getData.mockClear();
    const out = await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'u1' });

    expect(out).toEqual({ id: 'u1' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.getData).not.toHaveBeenCalled();
  });

  it('registers the cache key in the entity reverse-index on load', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const key = cacheKey('user', 'usr_id', 'usr_x');

    await svc.getOrLoad(key, async () => ({ id: 'u1' }), {
      ns: 'user',
      entityId: 'u1',
    });

    expect(redis.sAdd).toHaveBeenCalledWith(indexKey('user', 'u1'), key);
  });

  it('does not cache null loader results', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const loader = jest.fn(async () => null);
    const key = cacheKey('user', '_id', 'missing');

    await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'missing' });
    await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'missing' });

    expect(loader).toHaveBeenCalledTimes(2); // không cache => load lại
  });

  it('invalidateEntity deletes all indexed L2 keys and publishes them', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const k1 = cacheKey('user', '_id', 'u1');
    const k2 = cacheKey('user', 'usr_id', 'usr_x');
    await svc.getOrLoad(k1, async () => ({ id: 'u1' }), { ns: 'user', entityId: 'u1' });
    await svc.getOrLoad(k2, async () => ({ id: 'u1' }), { ns: 'user', entityId: 'u1' });

    await svc.invalidateEntity('user', 'u1');

    expect(redis.delKey).toHaveBeenCalledWith(k1);
    expect(redis.delKey).toHaveBeenCalledWith(k2);
    expect(redis.delKey).toHaveBeenCalledWith(indexKey('user', 'u1'));
    const last = redis.published.at(-1)!;
    expect(last.channel).toBe('cache:invalidate');
    expect(JSON.parse(last.msg).keys.sort()).toEqual([k1, k2].sort());
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest libs/db/src/cache/entity-cache.service --silent`
Expected: FAIL — `Cannot find module './entity-cache.service'`.

- [ ] **Step 3: Hiện thực (chưa wiring subscriber — chỉ field + getOrLoad + invalidate)**

Create `libs/db/src/cache/entity-cache.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { LruMap } from './lru-map';
import {
  CACHE_INVALIDATE_CHANNEL,
  CacheInvalidateMessage,
  indexKey,
} from './cache.keys';

export interface GetOrLoadOptions {
  /** Namespace của entity (vd 'user', 'room') — dùng cho reverse-index. */
  ns: string;
  /** Id canonical của entity (vd Mongo _id dạng chuỗi) — gom mọi alias key. */
  entityId: string;
  /** TTL L2 (giây). Mặc định REDIS_TTL.CACHE_ENTITY = 1800. */
  ttlSec?: number;
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
export class EntityCacheService {
  private readonly log = new Logger(EntityCacheService.name);
  private readonly l1 = new LruMap<unknown>({
    maxSize: L1_MAX_SIZE,
    ttlMs: L1_TTL_MS,
  });

  constructor(protected readonly redis: RedisService) {}

  /** Thời gian hiện tại (ms) — tách ra để test override nếu cần. */
  protected now(): number {
    return Date.now();
  }

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    opts: GetOrLoadOptions,
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
    await this.redis.setData(key, loaded, ttl);
    await this.redis.sAdd(indexKey(opts.ns, opts.entityId), key);
    await this.redis.expire(indexKey(opts.ns, opts.entityId), ttl);
    this.l1.set(key, loaded, this.now());
    return loaded;
  }

  /**
   * Xoá mọi alias key của entity ở L2 + broadcast để mọi instance drop L1.
   */
  async invalidateEntity(ns: string, entityId: string): Promise<void> {
    const idx = indexKey(ns, entityId);
    const keys = await this.redis.sMembers(idx);
    for (const k of keys) {
      await this.redis.delKey(k);
      this.l1.delete(k);
    }
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
}
```

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest libs/db/src/cache/entity-cache.service --silent`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/db/src/cache/entity-cache.service.ts libs/db/src/cache/entity-cache.service.spec.ts
git commit -m "feat(cache): add EntityCacheService two-tier getOrLoad + invalidate"
```

---

## Task 6: Wiring pub/sub subscriber + `CacheModule`

**Files:**
- Modify: `libs/db/src/cache/entity-cache.service.ts`
- Modify: `libs/db/src/cache/entity-cache.service.spec.ts`
- Create: `libs/db/src/cache/cache.module.ts`

- [ ] **Step 1: Viết test thất bại cho handler subscriber**

Thêm vào cuối `entity-cache.service.spec.ts`:

```ts
import { CACHE_INVALIDATE_CHANNEL } from './cache.keys';

describe('EntityCacheService pub/sub', () => {
  it('drops L1 keys when an invalidate message arrives on the channel', async () => {
    const redis = makeRedisMock();
    const handlers: Record<string, (ch: string, msg: string) => void> = {};
    const sub = {
      subscribe: jest.fn((_ch: string, cb: (e: Error | null) => void) => cb(null)),
      on: jest.fn((evt: string, cb: any) => {
        handlers[evt] = cb;
      }),
      quit: jest.fn(),
    };
    redis.client.duplicate = () => sub as any;

    const svc = new EntityCacheService(redis as any);
    const key = cacheKey('user', '_id', 'u1');
    await svc.getOrLoad(key, async () => ({ id: 'u1' }), { ns: 'user', entityId: 'u1' });

    svc.onModuleInit(); // mở subscriber, gắn handler 'message'
    // mô phỏng broadcast từ instance khác
    handlers['message'](CACHE_INVALIDATE_CHANNEL, JSON.stringify({ keys: [key] }));

    // L1 đã bị drop -> đọc lại phải gọi loader lần nữa
    const loader = jest.fn(async () => ({ id: 'u1' }));
    redis.store.delete(key); // giả lập L2 cũng đã bị xoá
    await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'u1' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest libs/db/src/cache/entity-cache.service --silent`
Expected: FAIL — `svc.onModuleInit is not a function`.

- [ ] **Step 3: Thêm lifecycle + subscriber vào service**

Trong `entity-cache.service.ts`, đổi khai báo class để implement lifecycle và thêm các thành viên:

Đổi dòng:
```ts
import { Injectable, Logger } from '@nestjs/common';
```
thành:
```ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type Redis from 'ioredis';
```

Đổi dòng:
```ts
export class EntityCacheService {
```
thành:
```ts
export class EntityCacheService implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis | null = null;
```

Thêm vào cuối class (trước dấu `}` đóng class):

```ts
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
```

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest libs/db/src/cache/entity-cache.service --silent`
Expected: PASS — 6 tests.

- [ ] **Step 5: Tạo `CacheModule`**

Create `libs/db/src/cache/cache.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { EntityCacheService } from './entity-cache.service';

/**
 * Provide EntityCacheService toàn cục. RedisModule đã @Global nhưng import
 * lại ở đây để CacheModule tự đủ phụ thuộc khi dùng riêng.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [EntityCacheService],
  exports: [EntityCacheService],
})
export class CacheModule {}
```

- [ ] **Step 6: Commit**

```bash
git add libs/db/src/cache/entity-cache.service.ts libs/db/src/cache/entity-cache.service.spec.ts libs/db/src/cache/cache.module.ts
git commit -m "feat(cache): wire pub/sub subscriber and add CacheModule"
```

---

## Task 7: `UserCacheRepository` (dùng chung trong `libs/db`)

**Files:**
- Create: `libs/db/src/cache/user-cache.repository.ts`
- Test: `libs/db/src/cache/user-cache.repository.spec.ts`

Repository inject `EntityCacheService` + Mongoose `Model<User>`. Trả full user doc (lean). Alias: `_id` và `usr_id`.

- [ ] **Step 1: Viết test thất bại**

Create `libs/db/src/cache/user-cache.repository.spec.ts`:

```ts
import { UserCacheRepository } from './user-cache.repository';
import { cacheKey } from './cache.keys';

describe('UserCacheRepository', () => {
  function makeCacheMock() {
    return {
      getOrLoad: jest.fn(async (_key: string, loader: () => Promise<any>) => loader()),
      invalidateEntity: jest.fn(async () => undefined),
    };
  }

  it('getById loads via cache using the _id alias key', async () => {
    const cache = makeCacheMock();
    const userModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'u1', usr_id: 'usr_x', usr_fullname: 'A' }) }),
      })),
    };
    const repo = new UserCacheRepository(cache as any, userModel as any);

    const out = await repo.getById('u1');

    expect(out).toEqual({ _id: 'u1', usr_id: 'usr_x', usr_fullname: 'A' });
    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('user', '_id', 'u1'),
      expect.any(Function),
      { ns: 'user', entityId: 'u1' },
    );
  });

  it('getByUsrId loads via cache using the usr_id alias key', async () => {
    const cache = makeCacheMock();
    const userModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'u1', usr_id: 'usr_x' }) }),
      })),
    };
    const repo = new UserCacheRepository(cache as any, userModel as any);

    await repo.getByUsrId('usr_x');

    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('user', 'usr_id', 'usr_x'),
      expect.any(Function),
      { ns: 'user', entityId: 'usr_x' },
    );
  });

  it('invalidate forwards the user _id to the cache service', async () => {
    const cache = makeCacheMock();
    const repo = new UserCacheRepository(cache as any, {} as any);

    await repo.invalidate('u1');

    expect(cache.invalidateEntity).toHaveBeenCalledWith('user', 'u1');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest libs/db/src/cache/user-cache.repository --silent`
Expected: FAIL — `Cannot find module './user-cache.repository'`.

- [ ] **Step 3: Hiện thực**

Create `libs/db/src/cache/user-cache.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../mongo/model/user.model';
import { EntityCacheService } from './entity-cache.service';
import { cacheKey } from './cache.keys';

const NS = 'user';

/**
 * Đọc User qua cache 2 tầng. Dùng chung cho auth & chat.
 *
 * QUAN TRỌNG: alias `_id` và `usr_id` chia sẻ cùng reverse-index theo
 * entityId tương ứng. invalidate() dùng `_id` (string) làm entityId
 * canonical — đảm bảo mọi điểm GHI user gọi invalidate(user._id).
 */
@Injectable()
export class UserCacheRepository {
  constructor(
    private readonly cache: EntityCacheService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async getById(id: string): Promise<User | null> {
    return this.cache.getOrLoad<User>(
      cacheKey(NS, '_id', id),
      async () =>
        (await this.userModel.findOne({ _id: id }).lean().exec()) as User | null,
      { ns: NS, entityId: id },
    );
  }

  async getByUsrId(usrId: string): Promise<User | null> {
    return this.cache.getOrLoad<User>(
      cacheKey(NS, 'usr_id', usrId),
      async () =>
        (await this.userModel
          .findOne({ usr_id: usrId })
          .lean()
          .exec()) as User | null,
      { ns: NS, entityId: usrId },
    );
  }

  /** Gọi sau mỗi lần ghi user (đổi tên/avatar/status...). `id` là user._id. */
  async invalidate(id: string): Promise<void> {
    await this.cache.invalidateEntity(NS, id);
  }
}
```

> **Lưu ý alias/invalidate:** `getById` index theo `entityId = _id`, còn `getByUsrId` index theo `entityId = usr_id`. Vì vậy `invalidate(_id)` chỉ xoá nhánh `_id`. Để invalidate xoá cả nhánh `usr_id`, các điểm ghi user phải gọi `invalidate` cho **cả hai** id khi có. Repo cung cấp `invalidate(id)` đơn giản; ở Task 9 (auth) ta truyền cả `user._id` và `user.usr_id`. Xem Step 3 của Task 9.

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest libs/db/src/cache/user-cache.repository --silent`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/db/src/cache/user-cache.repository.ts libs/db/src/cache/user-cache.repository.spec.ts
git commit -m "feat(cache): add shared UserCacheRepository"
```

---

## Task 8: Export cache từ `libs/db` + import `CacheModule` ở chat & auth

**Files:**
- Modify: `libs/db/src/index.ts`
- Modify: `apps/chat/src/app.module.ts`
- Modify: `apps/auth/src/app.module.ts`

- [ ] **Step 1: Export cache barrel**

Trong `libs/db/src/index.ts`, ngay sau dòng `export { RedisService } from './redis/redis.service';` thêm:

```ts
// Cache exports
export { CacheModule } from './cache/cache.module';
export { EntityCacheService } from './cache/entity-cache.service';
export { UserCacheRepository } from './cache/user-cache.repository';
export {
  cacheKey,
  indexKey,
  CACHE_INVALIDATE_CHANNEL,
} from './cache/cache.keys';
```

- [ ] **Step 2: Import `CacheModule` ở chat**

Trong `apps/chat/src/app.module.ts`: thêm `CacheModule` vào danh sách import từ `libs/db/src` (cùng dòng đang import `RedisModule`), rồi thêm `CacheModule` vào mảng `imports` của `@Module` (ngay sau `RedisModule`).

- [ ] **Step 3: Import `CacheModule` ở auth**

Trong `apps/auth/src/app.module.ts`: tương tự — thêm `CacheModule` vào import từ `libs/db` (hoặc `libs/db/src`) và vào mảng `imports` ngay sau `RedisModule`.

- [ ] **Step 4: Build kiểm tra type**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: không lỗi mới.

- [ ] **Step 5: Commit**

```bash
git add libs/db/src/index.ts apps/chat/src/app.module.ts apps/auth/src/app.module.ts
git commit -m "feat(cache): export cache barrel and register CacheModule in chat & auth"
```

---

## Task 9: Auth — invalidate user cache khi đổi profile/avatar

**Files:**
- Modify: `apps/auth/src/auth.module.ts`
- Modify: `apps/auth/src/auth.service.ts`

Auth phải provide `UserCacheRepository` (cần `EntityCacheService` global + User model forFeature mà auth đã có) và gọi invalidate sau khi ghi.

- [ ] **Step 1: Provide `UserCacheRepository` ở auth.module**

Trong `apps/auth/src/auth.module.ts`: import `UserCacheRepository` từ `libs/db/src`, thêm vào mảng `providers`. (Auth đã `MongooseModule.forFeature([{ name: User.name, schema: ... }])`; nếu chưa, thêm User vào forFeature — kiểm tra trước.)

- [ ] **Step 2: Inject vào `AuthService`**

Trong constructor `AuthService` ([auth.service.ts](../../../apps/auth/src/auth.service.ts)), thêm tham số:

```ts
    private readonly userCache: UserCacheRepository,
```
và import: `import { UserCacheRepository } from 'libs/db/src';`

- [ ] **Step 3: Gọi invalidate sau khi ghi**

Trong `updateAvatar` (sau khi `user.usr_avatar = ...; await user.save()` thành công) và `updateProfile` (sau khi `user.usr_fullname = ...; await user.save()`), thêm — invalidate cả hai nhánh alias:

```ts
    await Promise.all([
      this.userCache.invalidate(user._id.toString()),
      this.userCache.invalidate(user.usr_id),
    ]);
```

> Lý do hai lời gọi: `_id` và `usr_id` là hai entityId khác nhau của cùng user trong reverse-index (xem lưu ý Task 7). Xoá cả hai đảm bảo cả `getById` lẫn `getByUsrId` đều fresh.

- [ ] **Step 4: Build kiểm tra type**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: không lỗi mới.

- [ ] **Step 5: Commit**

```bash
git add apps/auth/src/auth.module.ts apps/auth/src/auth.service.ts
git commit -m "feat(auth): invalidate user cache on profile/avatar update"
```

---

## Task 10: Chat — `getUserInfo` đọc qua `UserCacheRepository`

**Files:**
- Modify: `apps/chat/src/rooms/rooms.module.ts`
- Modify: `apps/chat/src/rooms/rooms.service.ts`

`getUserInfo` hiện trả doc chỉ có `_id, usr_fullname, usr_id`. Các caller dùng `userInfo._id`, `userInfo.usr_id`, `userInfo.usr_fullname`. Full doc cache có đủ các field này nên thay thế an toàn.

- [ ] **Step 1: Provide `UserCacheRepository` ở rooms.module**

Trong `apps/chat/src/rooms/rooms.module.ts`: import `UserCacheRepository` từ `libs/db/src`; thêm vào `providers` và `exports`. (rooms.module đã `MongooseModule.forFeature` có User — xác nhận; nếu chưa thì thêm `{ name: User.name, schema: UserSchema }`.)

- [ ] **Step 2: Inject vào `RoomsService` và sửa `getUserInfo`**

Trong constructor `RoomsService`, thêm `private readonly userCache: UserCacheRepository,` và import từ `libs/db/src`.

Thay thân `getUserInfo` ([rooms.service.ts:989-1003](../../../apps/chat/src/rooms/rooms.service.ts#L989-L1003)) thành:

```ts
  public async getUserInfo(userId: string) {
    const user = await this.userCache.getById(userId);
    // Giữ nguyên hợp đồng cũ: chỉ trả user đang 'active'.
    if (!user || user.usr_status !== 'active') return null;
    return user;
  }
```

> Caller hiện dùng `userInfo._id`, `.usr_id`, `.usr_fullname` — đều có trong full doc. `usr_status` được lọc tại đây thay cho điều kiện cũ trong query.

- [ ] **Step 3: Build kiểm tra type**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: không lỗi mới. (Nếu báo `user._id` là `unknown`/ObjectId không gán được string ở caller, ép `.toString()` tại caller — nhưng các caller hiện đã so sánh `.toString()` nên thường không đổi.)

- [ ] **Step 4: Chạy toàn bộ test hiện có**

Run: `npx jest --silent`
Expected: PASS (các test cache + không vỡ gì).

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/rooms/rooms.module.ts apps/chat/src/rooms/rooms.service.ts
git commit -m "feat(chat): read user info through UserCacheRepository"
```

---

## Task 11: `RoomCacheRepository` (module chat)

**Files:**
- Create: `apps/chat/src/rooms/room-cache.repository.ts`
- Test: `apps/chat/src/rooms/room-cache.repository.spec.ts`

Room tra theo `room_id`, `pairId`, `_id`. entityId canonical = `room._id` (string). Cả ba alias key index theo cùng `room._id` để `invalidate(room._id)` xoá hết. → Repo cần biết `_id` của doc ngay trong loader; do đó index sau khi load.

Để giữ `getOrLoad` đơn giản (entityId truyền trước khi load), repo dùng entityId = chính giá trị tra (room_id/pair/_id) — GIỐNG user. Nghĩa là invalidate phải gọi cho tất cả id mà room được tra. Repo cung cấp `invalidate(room)` nhận nguyên doc và xoá cả ba nhánh.

- [ ] **Step 1: Viết test thất bại**

Create `apps/chat/src/rooms/room-cache.repository.spec.ts`:

```ts
import { RoomCacheRepository } from './room-cache.repository';
import { cacheKey } from 'libs/db/src';

describe('RoomCacheRepository', () => {
  function makeCacheMock() {
    return {
      getOrLoad: jest.fn(async (_k: string, loader: () => Promise<any>) => loader()),
      invalidateEntity: jest.fn(async () => undefined),
    };
  }

  it('getByRoomId loads via cache using the room_id alias key', async () => {
    const cache = makeCacheMock();
    const roomModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'rid1', room_id: 'r_abc' }) }),
      })),
    };
    const repo = new RoomCacheRepository(cache as any, roomModel as any);

    const out = await repo.getByRoomId('r_abc');

    expect(out).toEqual({ _id: 'rid1', room_id: 'r_abc' });
    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('room', 'room_id', 'r_abc'),
      expect.any(Function),
      { ns: 'room', entityId: 'r_abc' },
    );
  });

  it('getByPairOrRoomId queries both room_id and pair id', async () => {
    const cache = makeCacheMock();
    const roomModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'rid1', room_id: 'r_abc' }) }),
      })),
    };
    const repo = new RoomCacheRepository(cache as any, roomModel as any);

    await repo.getByPairOrRoomId('r_abc', 'pair_xy');

    expect(roomModel.findOne).toHaveBeenCalledWith({
      room_id: { $in: ['r_abc', 'pair_xy'] },
    });
  });

  it('invalidate clears room_id, pair-derived and _id branches', async () => {
    const cache = makeCacheMock();
    const repo = new RoomCacheRepository(cache as any, {} as any);

    await repo.invalidate({ _id: 'rid1', room_id: 'r_abc' } as any);

    expect(cache.invalidateEntity).toHaveBeenCalledWith('room', 'rid1');
    expect(cache.invalidateEntity).toHaveBeenCalledWith('room', 'r_abc');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận FAIL**

Run: `npx jest apps/chat/src/rooms/room-cache.repository --silent`
Expected: FAIL — `Cannot find module './room-cache.repository'`.

- [ ] **Step 3: Hiện thực**

Create `apps/chat/src/rooms/room-cache.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room } from 'libs/db/src';
import { EntityCacheService, cacheKey } from 'libs/db/src';

const NS = 'room';

/**
 * Đọc Room qua cache 2 tầng. Room tra theo room_id (chuỗi), pair id (phòng
 * private), và _id. Mỗi giá trị là một alias key index theo chính nó; vì
 * vậy invalidate(room) xoá cả ba nhánh dựa trên doc.
 */
@Injectable()
export class RoomCacheRepository {
  constructor(
    private readonly cache: EntityCacheService,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
  ) {}

  async getByRoomId(roomId: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, 'room_id', roomId),
      async () =>
        (await this.roomModel.findOne({ room_id: roomId }).lean().exec()) as Room | null,
      { ns: NS, entityId: roomId },
    );
  }

  /**
   * Tra phòng theo room_id HOẶC pair id (logic hiện tại của handle-chat).
   * Cache key dùng roomId làm khoá chính; pair chỉ tham gia ở loader.
   */
  async getByPairOrRoomId(roomId: string, pairId: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, 'room_id', roomId),
      async () =>
        (await this.roomModel
          .findOne({ room_id: { $in: [roomId, pairId] } })
          .lean()
          .exec()) as Room | null,
      { ns: NS, entityId: roomId },
    );
  }

  async getById(id: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, '_id', id),
      async () =>
        (await this.roomModel.findOne({ _id: id }).lean().exec()) as Room | null,
      { ns: NS, entityId: id },
    );
  }

  /** Gọi sau mỗi lần ghi room. Xoá mọi nhánh alias dựa trên doc. */
  async invalidate(room: Pick<Room, 'room_id'> & { _id: unknown }): Promise<void> {
    await Promise.all([
      this.cache.invalidateEntity(NS, String((room as { _id: unknown })._id)),
      this.cache.invalidateEntity(NS, room.room_id),
    ]);
  }
}
```

- [ ] **Step 4: Chạy để xác nhận PASS**

Run: `npx jest apps/chat/src/rooms/room-cache.repository --silent`
Expected: PASS — 3 tests.

- [ ] **Step 5: Provide ở rooms.module**

Trong `apps/chat/src/rooms/rooms.module.ts`: import `RoomCacheRepository` từ `./room-cache.repository`; thêm vào `providers` và `exports`.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/rooms/room-cache.repository.ts apps/chat/src/rooms/room-cache.repository.spec.ts apps/chat/src/rooms/rooms.module.ts
git commit -m "feat(chat): add RoomCacheRepository"
```

---

## Task 12: Chat — dùng `RoomCacheRepository` ở hot reads + invalidate điểm ghi

**Files:**
- Modify: `apps/chat/src/handle-chat/handle-chat.service.ts`
- Modify: `apps/chat/src/rooms/rooms.service.ts`

> **Quan trọng về tính đúng:** chỉ thay các `roomModel.findOne` **chỉ-đọc** trên hot-path bằng cache. KHÔNG thay những chỗ dùng kết quả để rồi `.save()`/sửa subdoc Mongoose (vì cache trả lean object, không có method document). Trong [handle-chat.service.ts](../../../apps/chat/src/handle-chat/handle-chat.service.ts), các lần `findOne` ở `createMessage`, `markReadUpTo`, `getMsgFromRoom`, `handleReact`, `handleDelete*` đều chỉ đọc `._id`, `.room_members`, `.room_type`, `.room_id` → an toàn để dùng cache. `handleGimMsg` đọc rồi `findOneAndUpdate` theo `_id` (không mutate object trả về) → cũng an toàn, nhưng phải invalidate sau update.

- [ ] **Step 1: Inject `RoomCacheRepository` vào `HandleChatService`**

Constructor đã có `roomService: RoomsService`. Thêm `private readonly roomCache: RoomCacheRepository,` và import `import { RoomCacheRepository } from '../rooms/room-cache.repository';`. (rooms.module export nó; chat module/handle-chat module import rooms.module — xác nhận handle-chat.module đã import RoomsModule.)

- [ ] **Step 2: Thay các read room ở handle-chat**

Thay từng mẫu sau (xuất hiện ở `createMessage`, `markReadUpTo`, `getMsgFromRoom`, `handleReact`, `handleDeleteForUser`, `handleDelete`):

Từ:
```ts
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
```
thành:
```ts
    const finInfo = await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    );
```

(Với `markReadUpTo` đang nằm trong `Promise.all([... this.roomModel.findOne(...)])` — tách ra: gọi `this.roomCache.getByPairOrRoomId(...)` thay cho phần room, giữ `messageModel.findById` như cũ.)

- [ ] **Step 3: Invalidate sau khi ghim (handleGimMsg)**

Trong `handleGimMsg`, sau `Promise.all([... roomModel.findOneAndUpdate ...])` (sau dòng ~764), thêm:

```ts
    await this.roomCache.invalidate(finInfo);
```

> `finInfo` lúc này là lean object từ cache (có `_id`, `room_id`) — đủ cho `invalidate`.

- [ ] **Step 4: Invalidate ở các điểm ghi room trong rooms.service**

Inject `RoomCacheRepository` vào `RoomsService` (thêm `private readonly roomCache: RoomCacheRepository,` + import từ `./room-cache.repository`). Sau **mỗi** thao tác ghi room dưới đây, thêm `await this.roomCache.invalidate(<roomDoc>);` (dùng doc có `_id` + `room_id`):

- `create` — sau `roomModel.create(...)` (dòng ~1103): `await this.roomCache.invalidate(newRoom);`
- `leavedRoom` — sau mỗi `roomModel.updateOne(...)` đổi members (dòng ~1308/1380) + sau `sRem`: invalidate room hiện tại.
- `removeMemberByAdmin` — sau `roomModel.updateMany/updateOne` (dòng ~1473): invalidate.
- `addMemberInRoom` — sau `roomModel.updateOne(...)` (dòng ~1594): invalidate.
- `changeLinkAvatarRoom` — sau `roomModel.findOneAndUpdate(...)` (dòng ~1744/1793): `await this.roomCache.invalidate(roominfo);` / `await this.roomCache.invalidate(room);`

> Với các chỗ chỉ có `roomId` (chuỗi) mà không có doc đầy đủ trong scope: gọi `await this.roomCache.invalidate({ _id: <_id>, room_id: <room_id> } as any);` dùng `_id` và `room_id` đang có trong hàm (mọi hàm này đều đã load room trước khi update).

- [ ] **Step 5: Build + chạy test**

Run: `npx tsc -p tsconfig.json --noEmit && npx jest --silent`
Expected: type OK; tất cả test PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/handle-chat/handle-chat.service.ts apps/chat/src/rooms/rooms.service.ts
git commit -m "feat(chat): serve room reads from cache and invalidate on room writes"
```

---

## Task 13: Kiểm chứng thủ công + đo tải

**Files:** không sửa code — bước verify.

- [ ] **Step 1: Build sạch cả workspace**

Run: `npm run build`
Expected: build thành công mọi app.

- [ ] **Step 2: Khởi động `auth` + `chat` (kèm Redis, Mongo) ở môi trường dev**

Theo cách chạy hiện có của dự án (vd `npm run start:dev chat`, `npm run start:dev auth`). Xác nhận log không có lỗi subscriber Redis; thấy `Redis ready`.

- [ ] **Step 3: Kiểm tra cache hit**

Bật log tạm trong `EntityCacheService` (hoặc dùng `redis-cli MONITOR`): gửi nhiều message vào cùng room → quan sát chỉ lần đầu chạm Mongo cho room/user, các lần sau lấy từ L1/L2 (không thấy query `findOne` room/user lặp). Xoá log tạm sau khi xong.

- [ ] **Step 4: Kiểm tra invalidation cross-service**

Đổi avatar/tên user qua `auth` → đọc lại ở `chat` (gửi message) → tên/avatar mới phản ánh ngay (không phải chờ TTL). Đổi thành viên/tên room qua `chat` → đọc lại thấy mới.

- [ ] **Step 5: Re-run load test 10k user**

Chạy lại kịch bản tải đã làm DB treo trước đây. Xác nhận số query Mongo cho room/user giảm mạnh và DB không còn treo.

- [ ] **Step 6: Commit (nếu có chỉnh nhỏ từ verify)**

```bash
git add -A
git commit -m "chore(cache): tidy up after manual verification"
```

---

## Ghi chú khi thực thi

- **Lean docs:** cache trả plain object (không phải Mongoose document) → không gọi `.save()` trên kết quả cache. Mọi chỗ cần mutate-then-save vẫn phải `roomModel.findOne` trực tiếp (Task 12 đã loại các chỗ đó ra).
- **`_id` là ObjectId:** khi build cache key/entityId luôn `String(_id)` / `.toString()`.
- **Degrade an toàn:** nếu Redis chết, `RedisService` trả null/log lỗi, `getOrLoad` rơi về loader Mongo — hệ thống vẫn chạy như trước, chỉ mất lợi ích cache.
- **YAGNI:** chưa cache friendship/message; chưa làm single-flight chống stampede (ghi chú tương lai nếu thấy nhiều miss đồng thời lúc khởi động).
