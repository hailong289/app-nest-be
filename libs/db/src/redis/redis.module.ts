import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisModuleOptions } from '../config/types/types.redis';
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
          username: redisOptions.username,
          password: redisOptions.password,
          db: redisOptions.db,
          keyPrefix: redisOptions.keyPrefix,
          lazyConnect: true, // Don't connect immediately, wait for manual connect()
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          enableOfflineQueue: true,
          reconnectOnError: (err) => {
            const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
            return targetErrors.some((targetError) =>
              err.message.includes(targetError),
            );
          },
          retryStrategy: (times) => {
            if (times > 20) {
              // Increased retry limit for better resilience
              logger.error('❌ Redis failed too many times. Stop retrying.');
              return null;
            }
            // Exponential backoff: 500ms, 1s, 1.5s, 2s, 2.5s, max 5s
            const delay = Math.min(times * 500, 5000);
            if (times % 5 === 1) {
              // Log every 5 attempts to reduce spam
              logger.warn(
                `🔄 Redis reconnecting in ${delay}ms (attempt ${times})`,
              );
            }
            return delay;
          },
        });

        let isReconnecting = false;
        let lastErrorTime = 0;

        client.on('connect', () => {
          isReconnecting = false;
          logger.log('✅ Redis connected');
        });

        client.on('ready', () => {
          logger.log('✅ Redis ready to accept commands');
        });

        client.on('error', (err) => {
          const now = Date.now();
          const errorCode =
            typeof err === 'object' && err !== null && 'code' in err && err.code
              ? String((err as { code: unknown }).code)
              : err.message;

          // Suppress ECONNRESET errors during reconnection to reduce log spam
          if (errorCode === 'ECONNRESET' && isReconnecting) {
            return; // Silent during reconnection
          }

          // Rate limit error logging (max 1 per 5 seconds)
          if (now - lastErrorTime < 5000) {
            return;
          }

          lastErrorTime = now;

          if (errorCode === 'ECONNRESET') {
            isReconnecting = true;
            logger.warn(
              '⚠️ Redis connection reset. Attempting to reconnect...',
            );
          } else {
            logger.error(`❌ Redis error [${errorCode}]:`, err.message);
          }
        });

        client.on('close', () => {
          isReconnecting = true;
          logger.warn('⚠️ Redis connection closed');
        });

        client.on('reconnecting', (delay) => {
          isReconnecting = true;
          logger.log(`🔄 Redis reconnecting after ${delay}ms...`);
        });

        // Connect after setup
        client.connect().catch((err) => {
          const errorMessage =
            typeof err === 'object' && err !== null && 'message' in err
              ? (err as { message: string }).message
              : String(err);
          logger.error('❌ Redis initial connection failed:', errorMessage);
        });

        return client;
      },
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}
