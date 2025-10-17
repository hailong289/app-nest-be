import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { GatewayController } from './gateway/gateway.controller';
import { GatewayService } from './gateway/gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayAuthController } from './auth/gateway-auth.controller';
import { SERVICES } from '@app/constants';
import { JwtModule } from '@nestjs/jwt';
import path from 'path';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { ConfigModule } from '@nestjs/config';
import { GatewayChatController } from './chat/gateway-chat.controller';
import { WsSharedModule } from 'libs/ws/src';
import { ChatGateway } from './ws/chat/chat-gatewayt';

import { GatewayAuthModule } from './auth/gateway-auth.module';
import { GatewayNotificationModule } from './notification/gateway-notification.module';
import { GatewayFileSystemModule } from './filesystem/gateway-filesystem.module';
import { GatewayChatModule } from './chat/gateway-chat.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/api-gateway/.env'),
    }),
    WsSharedModule,
    JwtModule.register({}),
    GatewayAuthModule,
    GatewayNotificationModule,
    GatewayFileSystemModule,
    GatewayChatModule,
  ],
  providers: [ChatGateway],
  controllers: [GatewayController],
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
      );
  }
}
