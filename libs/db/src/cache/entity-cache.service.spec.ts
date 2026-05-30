import { EntityCacheService } from './entity-cache.service';
import { cacheKey, indexKey, CACHE_INVALIDATE_CHANNEL } from './cache.keys';

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
    client: {
      duplicate: () => ({
        subscribe: jest.fn(),
        on: jest.fn(),
        quit: jest.fn(),
      }),
    },
    getData: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    setData: jest.fn(async (k: string, v: any) => void store.set(k, v)),
    delKey: jest.fn(async (k: string) => {
      const had = store.delete(k) || sets.delete(k);
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
    const out = await svc.getOrLoad(key, loader, {
      ns: 'user',
      entityId: 'u1',
    });

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
    expect(redis.setData).not.toHaveBeenCalled();
  });

  it('serves from L2 and back-fills L1 when L1 is cold', async () => {
    const redis = makeRedisMock();
    const key = cacheKey('user', '_id', 'u1');
    redis.store.set(key, { id: 'u1', from: 'l2' }); // pre-seed L2 only
    const svc = new EntityCacheService(redis as any);
    const loader = jest.fn(async () => ({ id: 'u1', from: 'loader' }));

    const first = await svc.getOrLoad(key, loader, {
      ns: 'user',
      entityId: 'u1',
    });
    expect(first).toEqual({ id: 'u1', from: 'l2' });
    expect(loader).not.toHaveBeenCalled(); // came from L2, not loader

    // second read should be L1 now: getData not hit again
    redis.getData.mockClear();
    const second = await svc.getOrLoad(key, loader, {
      ns: 'user',
      entityId: 'u1',
    });
    expect(second).toEqual({ id: 'u1', from: 'l2' });
    expect(redis.getData).not.toHaveBeenCalled();
  });

  it('indexes the cache key under each canonical id from indexIds', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const key = cacheKey('room', 'room_id', 'peer_123'); // looked up by alias
    await svc.getOrLoad(key, async () => ({ _id: 'rid1', room_id: 'a.b' }), {
      ns: 'room',
      entityId: 'peer_123',
      indexIds: (room: any) => [String(room._id), room.room_id],
    });
    expect(redis.sAdd).toHaveBeenCalledWith(indexKey('room', 'rid1'), key);
    expect(redis.sAdd).toHaveBeenCalledWith(indexKey('room', 'a.b'), key);
    // invalidating by the canonical _id must now find and delete the alias key
    await svc.invalidateEntity('room', 'rid1');
    expect(redis.delKey).toHaveBeenCalledWith(key);
  });

  it('invalidateEntity deletes all indexed L2 keys and publishes them', async () => {
    const redis = makeRedisMock();
    const svc = new EntityCacheService(redis as any);
    const k1 = cacheKey('user', '_id', 'u1');
    const k2 = cacheKey('user', 'usr_id', 'usr_x');
    await svc.getOrLoad(k1, async () => ({ id: 'u1' }), {
      ns: 'user',
      entityId: 'u1',
    });
    await svc.getOrLoad(k2, async () => ({ id: 'u1' }), {
      ns: 'user',
      entityId: 'u1',
    });

    await svc.invalidateEntity('user', 'u1');

    expect(redis.delKey).toHaveBeenCalledWith(k1);
    expect(redis.delKey).toHaveBeenCalledWith(k2);
    expect(redis.delKey).toHaveBeenCalledWith(indexKey('user', 'u1'));
    const last = redis.published.at(-1)!;
    expect(last.channel).toBe('cache:invalidate');
    expect(JSON.parse(last.msg).keys.sort()).toEqual([k1, k2].sort());
  });
});

describe('EntityCacheService pub/sub', () => {
  it('drops L1 keys when an invalidate message arrives on the channel', async () => {
    const redis = makeRedisMock();
    const handlers: Record<string, (ch: string, msg: string) => void> = {};
    const sub = {
      subscribe: jest.fn((_ch: string, cb: (e: Error | null) => void) =>
        cb(null),
      ),
      on: jest.fn((evt: string, cb: any) => {
        handlers[evt] = cb;
      }),
      quit: jest.fn(),
    };
    redis.client.duplicate = () => sub;

    const svc = new EntityCacheService(redis as any);
    const key = cacheKey('user', '_id', 'u1');
    await svc.getOrLoad(key, async () => ({ id: 'u1' }), {
      ns: 'user',
      entityId: 'u1',
    });

    svc.onModuleInit(); // mở subscriber, gắn handler 'message'
    // mô phỏng broadcast từ instance khác
    handlers['message'](
      CACHE_INVALIDATE_CHANNEL,
      JSON.stringify({ keys: [key] }),
    );

    // L1 đã bị drop -> đọc lại phải gọi loader lần nữa
    const loader = jest.fn(async () => ({ id: 'u1' }));
    redis.store.delete(key); // giả lập L2 cũng đã bị xoá
    await svc.getOrLoad(key, loader, { ns: 'user', entityId: 'u1' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
