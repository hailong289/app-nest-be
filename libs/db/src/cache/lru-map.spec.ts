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
    expect(m.get('a', 1001)).toBeUndefined(); // 1 ms past expiresAt (= 0 + 1000)
  });

  it('treats an entry as expired exactly at its expiresAt tick (strict TTL)', () => {
    const m = new LruMap<number>({ maxSize: 10, ttlMs: 1000 });
    m.set('a', 1, 0); // expiresAt = 1000
    expect(m.get('a', 1000)).toBeUndefined(); // valid for exactly ttlMs ms, gone at the tick
  });

  it('re-set of an existing key moves it to the most-recently-used position', () => {
    const m = new LruMap<number>({ maxSize: 2, ttlMs: 10_000 });
    m.set('a', 1, 0);
    m.set('b', 2, 0);
    m.set('a', 99, 1); // re-write 'a' -> 'a' becomes MRU, 'b' is now LRU
    m.set('c', 3, 2); // exceeds size -> evict 'b'
    expect(m.get('b', 3)).toBeUndefined();
    expect(m.get('a', 3)).toBe(99);
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
