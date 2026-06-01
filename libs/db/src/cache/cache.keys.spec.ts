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
