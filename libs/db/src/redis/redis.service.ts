import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  // Getter to access raw Redis instance for advanced usage (e.g., WebSocket adapter)
  get client(): Redis {
    return this.redis;
  }

  async setOnline(userId: string) {
    await this.redis.set(`presence:${userId}`, 'online', 'EX', 60);
  }

  async isOnline(userId: string) {
    return (await this.redis.get(`presence:${userId}`)) === 'online';
  }

  /**
   * Set data in Redis.
   * @param key - The key to save in Redis.
   * @param value - The value to save (will be JSON stringified).
   * @param expireTime - (optional) Expiration time in seconds.
   */
  async setData(key: string, value: any, expireTime?: number): Promise<void> {
    try {
      const data = JSON.stringify(value);
      if (expireTime) {
        await this.redis.setex(key, expireTime, data);
      } else {
        await this.redis.set(key, data);
      }
    } catch (err) {
      console.error('Redis setData error:', err);
    }
  }

  /**
   * Get data from Redis.
   * @param key - The Redis key.
   * @returns The parsed JSON data or null.
   */
  async getData<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      return data ? (JSON.parse(data) as T) : null;
    } catch (err) {
      console.error('Redis getData error:', err);
      return null;
    }
  }

  /**
   * Get values of multiple keys.
   * @param keys - Array of Redis keys.
   * @returns Array of values (null if key does not exist).
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      if (!keys || keys.length === 0) return [];
      return await this.redis.mget(keys);
    } catch (err) {
      console.error('Redis mget error:', err);
      return keys.map(() => null);
    }
  }

  /**
   * Delete a key from Redis.
   * @param key - The key to delete.
   * @returns 1 if deleted, 0 if not found.
   */
  async delKey(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch (err) {
      console.error('Redis delKey error:', err);
      return 0;
    }
  }

  /**
   * Push one or more values to a Redis List.
   * @param key - The Redis key.
   * @param values - One or more values to push.
   * @returns New list length.
   */
  async pushToArray(key: string, ...values: string[]): Promise<number | null> {
    try {
      const type = await this.redis.type(key);
      if (type !== 'none' && type !== 'list') {
        throw new Error(`Expected list but found type: ${type}`);
      }

      const strValues = values.map((v) => v.toString());
      return await this.redis.rpush(key, ...strValues);
    } catch (err) {
      console.error('Redis pushToArray error:', err);
      return null;
    }
  }

  /**
   * Get all items from a Redis List.
   * @param key - The Redis key.
   * @returns Array of list items.
   */
  async getArray(key: string): Promise<string[]> {
    try {
      return await this.redis.lrange(key, 0, -1);
    } catch (err) {
      console.error('Redis getArray error:', err);
      return [];
    }
  }

  /**
   * Remove a value from a Redis List.
   * @param key - The Redis key.
   * @param value - The value to remove.
   * @param count - Number of occurrences to remove (0 = all).
   * @returns Number of removed elements.
   */
  async removeFromArray(
    key: string,
    value: string,
    count = 0,
  ): Promise<number> {
    try {
      return await this.redis.lrem(key, count, value);
    } catch (err) {
      console.error('Redis removeFromArray error:', err);
      return 0;
    }
  }

  /**
   * Increment a key's value, and optionally set expiration.
   * @param key - The Redis key.
   * @param ttl - Time-to-live in seconds if key is new.
   * @returns The incremented value.
   */
  async incr(key: string, ttl = 60): Promise<number> {
    try {
      const result = await this.redis.incr(key);
      if (result === 1) {
        await this.redis.expire(key, ttl);
      }
      return result;
    } catch (err) {
      console.error('Redis incr error:', err);
      return 0;
    }
  }

  /**
   * Add one or more members to a Redis Set.
   * @param key - The Redis key.
   * @param values - The values to add.
   * @returns Number of elements added.
   */
  async sAdd(key: string, ...values: string[]): Promise<number> {
    try {
      if (values.length === 0) return 0;
      return await this.redis.sadd(key, ...values);
    } catch (err) {
      console.error('Redis sAdd error:', err);
      return 0;
    }
  }

  /**
   * Remove one or more members from a Redis Set.
   * @param key - The Redis key.
   * @param values - The values to remove.
   * @returns Number of elements removed.
   */
  async sRem(key: string, ...values: string[]): Promise<number> {
    try {
      if (values.length === 0) return 0;
      return await this.redis.srem(key, ...values);
    } catch (err) {
      console.error('Redis sRem error:', err);
      return 0;
    }
  }

  /**
   * Check if a member exists in a Redis Set.
   * @param key - The Redis key.
   * @param value - The value to check.
   * @returns true if member exists, false otherwise.
   */
  async sIsMember(key: string, value: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(key, value);
      return result === 1;
    } catch (err) {
      console.error('Redis sIsMember error:', err);
      return false;
    }
  }
  async SisMembers({ key, values }: { key: string; values: string[] }) {
    try {
      const pipeline = this.redis.pipeline();

      for (const v of values) {
        pipeline.sismember(key, v);
      }

      const results = await pipeline.exec();

      // Handle empty or null results
      if (!results || results.length === 0) {
        return values.map((uid) => ({
          key: uid,
          value: false,
        }));
      }

      // Safe iteration: check if results is iterable and has proper structure
      return values.map((uid, idx) => {
        const result = results[idx];
        const value = result && Array.isArray(result) ? result[1] === 1 : false;
        return {
          key: uid,
          value,
        };
      });
    } catch (err) {
      console.error('Redis SisMembers error:', err);
      // Return all as not members on error
      return values.map((uid) => ({
        key: uid,
        value: false,
      }));
    }
  }
  /**
   * Get the number of members in a Redis Set.
   * @param key - The Redis key.
   * @returns The cardinality (size) of the set.
   */
  async sCard(key: string): Promise<number> {
    try {
      return await this.redis.scard(key);
    } catch (err) {
      console.error('Redis sCard error:', err);
      return 0;
    }
  }

  /**
   * Get all members of a Redis Set.
   * @param key - The Redis key.
   * @returns Array of set members.
   */
  async sMembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch (err) {
      console.error('Redis sMembers error:', err);
      return [];
    }
  }

  /**
   * Add to many Sets in a single pipeline (one round-trip for the whole batch),
   * instead of N separate SADD commands. Each entry maps a key to the values to
   * add. Entries with no values are skipped.
   */
  async pipelineSAdd(
    entries: { key: string; values: string[] }[],
  ): Promise<void> {
    try {
      const valid = entries.filter((e) => e.values.length > 0);
      if (valid.length === 0) return;
      const pipeline = this.redis.pipeline();
      for (const { key, values } of valid) {
        pipeline.sadd(key, ...values);
      }
      await pipeline.exec();
    } catch (err) {
      console.error('Redis pipelineSAdd error:', err);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // HASH helpers (used by call invite tracking + per-room call state)
  // ────────────────────────────────────────────────────────────────

  /**
   * Set one or more fields on a Redis Hash. Accepts either an object
   * map (`{ field: value, ... }`) or a flat (field, value) pair.
   * Values are stored verbatim — caller stringifies if needed.
   */
  async hSet(
    key: string,
    fieldOrMap: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    try {
      if (typeof fieldOrMap === 'string') {
        return await this.redis.hset(key, fieldOrMap, value ?? '');
      }
      // ioredis accepts { f: v, ... } as a single arg.
      return await this.redis.hset(key, fieldOrMap);
    } catch (err) {
      console.error('Redis hSet error:', err);
      return 0;
    }
  }

  /**
   * Read all fields of a Redis Hash. Returns `{}` on miss/error so
   * callers can iterate without null-checks.
   */
  async hGetAll(key: string): Promise<Record<string, string>> {
    try {
      return (await this.redis.hgetall(key)) ?? {};
    } catch (err) {
      console.error('Redis hGetAll error:', err);
      return {};
    }
  }

  /**
   * Delete one or more fields from a Redis Hash. Returns the number of
   * fields actually removed (0 on missing key/field — not an error).
   */
  async hDel(key: string, ...fields: string[]): Promise<number> {
    try {
      if (fields.length === 0) return 0;
      return await this.redis.hdel(key, ...fields);
    } catch (err) {
      console.error('Redis hDel error:', err);
      return 0;
    }
  }

  /**
   * Set / refresh TTL on an existing key. No-op if key doesn't exist
   * (returns 0). Used to extend call-state lifetimes on activity.
   */
  async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.redis.expire(key, seconds);
    } catch (err) {
      console.error('Redis expire error:', err);
      return 0;
    }
  }

  /**
   * Add a member to a sorted set, or update its score if it already exists.
   * @param key - The Redis key.
   * @param score - The score.
   * @param member - The member.
   */
  async zAdd(
    key: string,
    score: number,
    member: string,
  ): Promise<number | string> {
    try {
      return await this.redis.zadd(key, score, member);
    } catch (err) {
      console.error('Redis zAdd error:', err);
      return 0;
    }
  }

  /**
   * Remove one or more members from a sorted set.
   * @param key - The Redis key.
   * @param members - The members to remove.
   */
  async zRem(key: string, ...members: string[]): Promise<number> {
    try {
      if (members.length === 0) return 0;
      return await this.redis.zrem(key, ...members);
    } catch (err) {
      console.error('Redis zRem error:', err);
      return 0;
    }
  }

  /**
   * Return a range of members in a sorted set, by score.
   * @param key - The Redis key.
   * @param min - The minimum score.
   * @param max - The maximum score.
   */
  async zRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]> {
    try {
      return await this.redis.zrangebyscore(key, min, max);
    } catch (err) {
      console.error('Redis zRangeByScore error:', err);
      return [];
    }
  }

  /**
   * Get the score of a member in a sorted set.
   * @param key - The Redis key.
   * @param member - The member.
   */
  async zScore(key: string, member: string): Promise<string | null> {
    try {
      return await this.redis.zscore(key, member);
    } catch (err) {
      console.error('Redis zScore error:', err);
      return null;
    }
  }

  /**
   * Iterate keys matching a glob pattern using Redis SCAN. Use this instead
   * of KEYS in production paths — KEYS blocks the entire instance, SCAN
   * cooperates with normal traffic.
   *
   * Caller pumps the cursor in a loop; start with `'0'`, stop when the
   * returned cursor is `'0'`.
   *
   * @param cursor Cursor value from the previous call (or `'0'` to start).
   * @param match Glob pattern (e.g. `chat:user:*:online`).
   * @param count Hint to Redis about page size — actual returned count varies.
   */
  async scan(
    cursor: string,
    match: string,
    count = 100,
  ): Promise<{ cursor: string; keys: string[] }> {
    try {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        match,
        'COUNT',
        count,
      );
      return { cursor: next, keys };
    } catch (err) {
      console.error('Redis scan error:', err);
      return { cursor: '0', keys: [] };
    }
  }

  /**
   * Publish a message to a channel.
   * @param channel - The channel name.
   * @param message - The message string or object.
   */
  async publish(channel: string, message: string | object): Promise<number> {
    try {
      const msg =
        typeof message === 'string' ? message : JSON.stringify(message);
      return await this.redis.publish(channel, msg);
    } catch (err) {
      console.error('Redis publish error:', err);
      return 0;
    }
  }

  /**
   * Subscribe to a channel.
   * @param channel - The channel name.
   * @param callback - Function to handle messages.
   */
  subscribe(channel: string, callback: (message: string) => void): void {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe(channel, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${channel}:`, err);
        return;
      }
    });

    subscriber.on('message', (chan, msg) => {
      if (chan === channel) {
        callback(msg);
      }
    });
  }
}
