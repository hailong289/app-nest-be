import { Global, Logger, Module, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import { WsJwtGuard } from './ws-jwt.guard';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { RedisIoAdapter } from './redis-io.adapter';
import { JwtModule } from '@nestjs/jwt';

// Module rất nhẹ, chỉ export guard (và có sẵn RedisModule để Gateway dùng)
@Global()
@Module({
  imports: [ConfigModule, RedisModule, JwtModule],
  providers: [Logger, WsJwtGuard],
  exports: [RedisModule, WsJwtGuard, ConfigModule, JwtModule],
})
export class WsSharedModule {}

// Hàm tiện ích để set adapter trong main.ts (để mỗi app gọi 1 dòng)
export async function useSharedRedisAdapter(
  app: INestApplication,
): Promise<void> {
  const logger = new Logger('SharedRedisAdapter');

  try {
    const redisService = app.get(RedisService);
    const baseClient = redisService.client;

    const pubClient = baseClient.duplicate();
    const subClient = baseClient.duplicate();

    pubClient.on('error', (err) =>
      logger.error(`Redis pub client error: ${err?.message ?? err}`),
    );

    subClient.on('error', (err) =>
      logger.error(`Redis sub client error: ${err?.message ?? err}`),
    );

    await Promise.all([pubClient.connect(), subClient.connect()]);

    app.useWebSocketAdapter(new RedisIoAdapter(app, pubClient, subClient));
    logger.log(`Redis adapter initialized`);
  } catch (error) {
    logger.error(
      `Failed to initialize Redis adapter. Falling back to default in-memory adapter.`,
      error as Error,
    );
  }
}
