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
import { GatewayAiModule } from './ai/gateway-ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/api-gateway/.env`,
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
    GatewayAiModule,
    ChatWebSocketModule,
    DocWebSocketModule,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(
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
      { path: 'ai/search', method: RequestMethod.POST },
      { path: 'ai/suggest-replies', method: RequestMethod.POST },
      { path: 'notifications', method: RequestMethod.GET },
      { path: 'notifications/read-all', method: RequestMethod.PUT },
      {
        path: 'notifications/:notificationId/read',
        method: RequestMethod.PUT,
      },
    );
  }
}
