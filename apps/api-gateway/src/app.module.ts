import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import path from 'path';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { RequestLoggerMiddleware } from './middlewares/request-logger.middleware';
import { ConfigModule } from '@nestjs/config';
import { GatewayAuthModule } from './auth/gateway-auth.module';
import { GatewayNotificationModule } from './notification/gateway-notification.module';
import { GatewayFileSystemModule } from './filesystem/gateway-filesystem.module';
import { GatewayChatModule } from './chat/gateway-chat.module';
import { GatewayModule } from './gateway/gateway.module';

import redisConfig from 'libs/db/src/config/redis.config';
import { kafkaConfig } from 'libs/kafka';
import { GatewayAiModule } from './ai/gateway-ai.module';
import { GatewayLearningModule } from './learning/gateway-learning.module';
import { RedisModule } from 'libs/db/src';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), `apps/api-gateway/.env`),
      load: [redisConfig, kafkaConfig],
    }),
    RedisModule,
    JwtModule.register({}),
    GatewayModule,
    GatewayAuthModule,
    GatewayNotificationModule,
    GatewayFileSystemModule,
    GatewayChatModule,
    GatewayAiModule,
    GatewayLearningModule,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Request logger first → sees EVERY request (auth-protected or not)
    // and logs the final status code in res.on('finish').
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');

    consumer.apply(AuthMiddleware).forRoutes(
      { path: 'auth/logout', method: RequestMethod.ALL },
      { path: 'auth/refresh-token', method: RequestMethod.POST },
      { path: 'auth/update-password', method: RequestMethod.POST },
      { path: 'auth/reset-password', method: RequestMethod.POST },
      { path: 'auth/update-avatar', method: RequestMethod.POST },
      { path: 'auth/update-profile', method: RequestMethod.POST },
      // Profile + per-device session endpoints — require an authenticated
      // user so middleware can populate `req.user._id` / `clientId`. Without
      // this, getMe() / listSessions() / logoutDevice() / logoutAllDevices()
      // get an empty req.user and dispatch with `userId: undefined`, which
      // the auth-service rejects as "User ID is required".
      { path: 'auth/me', method: RequestMethod.GET },
      { path: 'auth/sessions', method: RequestMethod.GET },
      { path: 'auth/sessions/revoke-all', method: RequestMethod.POST },
      { path: 'auth/sessions/:clientId/revoke', method: RequestMethod.POST },
      { path: 'chat/*path', method: RequestMethod.ALL },
      { path: 'social/*path', method: RequestMethod.ALL },
      { path: 'documents', method: RequestMethod.ALL },
      { path: 'documents/*path', method: RequestMethod.ALL },
      { path: 'filesystem/upload-single-user', method: RequestMethod.POST },
      { path: 'ai/search', method: RequestMethod.POST },
      { path: 'ai/suggest-replies', method: RequestMethod.POST },
      { path: 'ai/transcribe-attachment', method: RequestMethod.POST },
      { path: 'notifications', method: RequestMethod.GET },
      { path: 'notifications/read-all', method: RequestMethod.PUT },
      {
        path: 'notifications/:notificationId/read',
        method: RequestMethod.PUT,
      },
      { path: 'learning/quizz/*path', method: RequestMethod.ALL },
      { path: 'learning/flashcard/*path', method: RequestMethod.ALL },
      { path: 'learning/todo/*path', method: RequestMethod.ALL },
    );
  }
}
