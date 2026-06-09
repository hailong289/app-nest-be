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
