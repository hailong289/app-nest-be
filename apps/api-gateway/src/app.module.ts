import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayFilesystemController } from './filesystem/gateway-filesystem.controller';
import { GatewayAuthController } from './auth/gateway-auth.controller';
import { GatewayNotificationController } from './notification/gateway-notification.controller';
import { SERVICES } from '@app/constants';
import { JwtModule } from '@nestjs/jwt';
import path, { join } from 'path';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { ConfigModule } from '@nestjs/config';
import { KafkaClientModule } from './kafka.module';
import { GatewayChatController } from './chat/gateway-chat.controller';
// import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/api-gateway/.env'),
    }),
    ClientsModule.register([
      {
        name: SERVICES.AUTH,
        transport: Transport.GRPC,
        options: {
          package: 'auth',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_AUTH_PROTO_PATH || 'libs/grpc/auth.proto',
          ),
          url: (() => {
            const hostEnv = (process.env.GATEWAY_AUTH_HOST || '').trim();
            const isDockerHost = hostEnv && hostEnv.includes('auth');
            const host =
              isDockerHost && process.env.NODE_ENV !== 'production'
                ? 'localhost'
                : hostEnv || 'localhost';
            const port = process.env.GATEWAY_AUTH_PORT || '5001';
            // helpful debug log for name resolution issues
            console.log('Gateway gRPC auth URL:', `${host}:${port}`);
            return `${host}:${port}`;
          })(),
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
        },
      },
      {
        name: SERVICES.CHAT,
        transport: Transport.GRPC,
        options: {
          package: 'chat',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_CHAT_PROTO_PATH || 'libs/grpc/chat.proto',
          ),
          url: (() => {
            const hostEnv = (process.env.GATEWAY_CHAT_HOST || '').trim();
            const isDockerHost = hostEnv && hostEnv.includes('chat');
            const host =
              isDockerHost && process.env.NODE_ENV !== 'production'
                ? 'localhost'
                : hostEnv || 'localhost';
            const port = process.env.GATEWAY_CHAT_PORT || '5003';
            return `${host}:${port}`;
          })(),
        },
      },
    ]),
    JwtModule.register({}),
    KafkaClientModule,
  ],
  controllers: [
    GatewayController,
    GatewayFilesystemController,
    GatewayAuthController,
    GatewayNotificationController,
    GatewayChatController,
  ],
  providers: [GatewayService],
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
        { path: 'chat/*', method: RequestMethod.ALL },
      );
  }
}
