import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  async setOnline(userId: string) {
    await this.redis.set(`presence:${userId}`, 'online', 'EX', 60);
  }

  async isOnline(userId: string) {
    return (await this.redis.get(`presence:${userId}`)) === 'online';
  }
}
