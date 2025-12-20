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
   * Add a member to a Redis Set.
   * @param key - The Redis key.
   * @param value - The value to add.
   * @returns Number of elements added (1 or 0).
   */
  async sAdd(key: string, value: string): Promise<number> {
    try {
      return await this.redis.sadd(key, value);
    } catch (err) {
      console.error('Redis sAdd error:', err);
      return 0;
    }
  }

  /**
   * Remove a member from a Redis Set.
   * @param key - The Redis key.
   * @param value - The value to remove.
   * @returns Number of elements removed.
   */
  async sRem(key: string, value: string): Promise<number> {
    try {
      return await this.redis.srem(key, value);
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
}
