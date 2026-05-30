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
