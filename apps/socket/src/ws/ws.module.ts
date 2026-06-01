import { Global, Logger, Module, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import { WsJwtGuard } from './ws-jwt.guard';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { RedisIoAdapter } from './redis-io.adapter';
import { JwtModule } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { SocketGatewayClient } from '../gateway/gateway-client.service';

/**
 * Lightweight shared module for the socket app: provides JWT guard +
 * PresenceService for gateways, and exposes Redis/Config/Jwt modules so
 * child modules don't have to re-import them.
 *
 * Lives inside apps/socket because no other microservice needs the WS-side
 * pieces (guard, adapter). Cross-service emit goes through libs/ws's
 * RemoteEmitter instead.
 */
@Global()
@Module({
  imports: [ConfigModule, RedisModule, JwtModule],
  providers: [Logger, WsJwtGuard, PresenceService, SocketGatewayClient],
  exports: [
    RedisModule,
    WsJwtGuard,
    ConfigModule,
    JwtModule,
    PresenceService,
    SocketGatewayClient,
  ],
})
export class WsSharedModule {}

/**
 * Helper to wire up the Redis-backed Socket.IO adapter in apps/socket main.ts.
 * Call once during bootstrap before `app.listen()`.
 */
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
