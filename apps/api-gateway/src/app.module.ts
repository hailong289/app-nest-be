import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import path from 'path';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { ConfigModule } from '@nestjs/config';
import { WsSharedModule } from 'libs/ws/src';
import { GatewayAuthModule } from './auth/gateway-auth.module';
import { GatewayNotificationModule } from './notification/gateway-notification.module';
import { GatewayFileSystemModule } from './filesystem/gateway-filesystem.module';
import { GatewayChatModule } from './chat/gateway-chat.module';
import { GatewayModule } from './gateway/gateway.module';
import redisConfig from 'libs/db/src/config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        'apps/api-gateway/.env.development',
      ), // thay đổi file để load môi trường ví dụ .env.production
      load: [redisConfig],
    }),
    WsSharedModule,
    JwtModule.register({}),
    GatewayModule,
    GatewayAuthModule,
    GatewayNotificationModule,
    GatewayFileSystemModule,
    GatewayChatModule,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes(
        { path: 'auth/logout', method: RequestMethod.ALL },
        { path: 'auth/refresh-token', method: RequestMethod.POST },
        { path: 'auth/update-password', method: RequestMethod.POST },
        { path: 'auth/reset-password', method: RequestMethod.POST },
        { path: 'chat/*path', method: RequestMethod.ALL },
        { path: 'social/*path', method: RequestMethod.ALL },
      );
  }
}
