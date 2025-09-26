import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayFilesystemController } from './filesystem/gateway-filesystem.controller';
import { GatewayAuthController } from './auth/gateway-auth.controller';
import { GatewayChatController } from './chat/gateway-chat.controller';
import { GatewayNotificationController } from './notification/gateway-notification.controller';
import { SERVICES } from '@app/constants';
import { JwtModule } from '@nestjs/jwt';
import path, { join } from 'path';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { ConfigModule } from '@nestjs/config';

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
          protoPath: join(__dirname, '../../../libs/grpc/auth.proto'),
          url: `${process.env.AUTH_HOST || 'localhost'}:${process.env.AUTH_PORT || '3001'}`,
        },
      },
      {
        name: SERVICES.CHAT,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3002,
        },
      },
      {
        name: SERVICES.NOTIFICATION,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3003,
        },
      },
      {
        name: SERVICES.FILESYSTEM,
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'filesystem-service',
            brokers: ['localhost:9092']
          },
          consumer: {
            groupId: 'filesystem-consumer',
          },
        },
      },
    ]),
    JwtModule.register({}),
  ],
  controllers: [
    GatewayController,
    GatewayFilesystemController,
    GatewayAuthController,
    GatewayChatController,
    GatewayNotificationController,
  ],
  providers: [GatewayService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes(
        { path: 'auth/logout', method: RequestMethod.ALL },
      );
  }
}