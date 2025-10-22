import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisModuleOptions } from './types';
import { RedisService } from './redis.service';

@Global() // để có thể inject RedisClient ở bất kỳ module nào
@Module({
  imports: [], // không cần imports ConfigModule vì mỗi service có config riêng nếu dùng như cũ nó xung đột env
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisOptions = configService.get<RedisModuleOptions>('redis');
        const logger = new Logger('RedisModule');
        if (!redisOptions) {
          throw new Error('Redis configuration "redis" is missing');
        }
        const client = new Redis({
          host: redisOptions.host,
          port: redisOptions.port,
          password: redisOptions.password,
          db: redisOptions.db,
          keyPrefix: redisOptions.keyPrefix,
          retryStrategy: (times) => {
            if (times > 10) {
              // 10 lần thử lại nếu không dc end luôn không retry nữa
              logger.error('❌ Redis failed too many times. Stop retrying.');
              return null; // <- Dừng hẳn reconnect
            }
            const delay = Math.min(times * 500, 3000);
            logger.warn(
              `🔄 Redis reconnecting in ${delay}ms (attempt ${times})`,
            );
            return delay;
          },
        });

        client.on('connect', () => logger.log('✅ Redis connected'));
        client.on('error', (err) => logger.error('❌ Redis error', err));

        return client;
      },
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}
