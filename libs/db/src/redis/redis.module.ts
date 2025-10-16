import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import redisConfig from './redis.config';
import { RedisModuleOptions } from './types';
import path from 'path';
import { RedisService } from './redis.service';

@Global() // để có thể inject RedisClient ở bất kỳ module nào
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '..', '.env'), // ./src/.env
        path.resolve(__dirname, '../../.env'), // fallback
      ],
      load: [redisConfig],
    }),
  ],
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
