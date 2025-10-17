import { Global, Logger, Module, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import { WsJwtGuard } from './ws-jwt.guard';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { RedisIoAdapter } from './redis-io.apdapter';
import { JwtModule } from '@nestjs/jwt';

// Module rất nhẹ, chỉ export guard (và có sẵn RedisModule để Gateway dùng)
@Global()
@Module({
  imports: [ConfigModule, RedisModule, JwtModule],
  providers: [Logger, WsJwtGuard],
  exports: [RedisModule, WsJwtGuard],
})
export class WsSharedModule {}

// Hàm tiện ích để set adapter trong main.ts (để mỗi app gọi 1 dòng)
export function useSharedRedisAdapter(app: INestApplication): void {
  const logger = new Logger('SharedRedisAdapter');
  const redisService = app.get(RedisService);
  const redis = redisService.client;
  const sub = redis.duplicate();
  app.useWebSocketAdapter(new RedisIoAdapter(app, redis, sub));
  logger.log(`Redis Adapter Initialized `);
}
