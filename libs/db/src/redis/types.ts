import { RedisOptions } from 'ioredis';

export interface RedisModuleOptions extends RedisOptions {
  keyPrefix?: string;
  name?: string; // optional: useful if you want multi-client
  host: string;
  port: number;
  password?: string;
  ttl?: string;
}
