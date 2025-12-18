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
import { ChatWebSocketModule } from './ws/chat/chat.module';
import { DocWebSocketModule } from './ws/doc/doc.module';
import redisConfig from 'libs/db/src/config/redis.config';
import { kafkaConfig } from 'libs/kafka';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/api-gateway/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [redisConfig, kafkaConfig],
    }),
    WsSharedModule,
    JwtModule.register({}),
    GatewayModule,
    GatewayAuthModule,
    GatewayNotificationModule,
    GatewayFileSystemModule,
    GatewayChatModule,
    ChatWebSocketModule,
    DocWebSocketModule,
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
        { path: 'auth/update-avatar', method: RequestMethod.POST },
        { path: 'auth/update-profile', method: RequestMethod.POST },
        { path: 'chat/*path', method: RequestMethod.ALL },
        { path: 'social/*path', method: RequestMethod.ALL },
        { path: 'documents', method: RequestMethod.ALL },
        { path: 'documents/*path', method: RequestMethod.ALL },
        { path: 'filesystem/upload-single-user', method: RequestMethod.POST },
      );
  }
}
