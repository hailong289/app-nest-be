import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayFilesystemController } from './filesystem/gateway-filesystem.controller';
import { GatewayAuthController } from './auth/gateway-auth.controller';
import { GatewayChatController } from './chat/gateway-chat.controller';
import { GatewayNotificationController } from './notification/gateway-notification.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'AUTH_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3001,
        },
      },
      {
        name: 'CHAT_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3002,
        },
      },
      {
        name: 'NOTIFICATION_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3003,
        },
      },
      {
        name: 'FILESYSTEM_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'filesystem-service',
            brokers: ['localhost:9092'],
            connectionTimeout: 3000,
            requestTimeout: 25000,
            retry: {
              initialRetryTime: 100,
              retries: 3,
            },
          },
          consumer: {
            groupId: 'filesystem-consumer',
            allowAutoTopicCreation: false,
          },
          producer: {
            allowAutoTopicCreation: true,
            maxInFlightRequests: 1,
            idempotent: false,
            transactionTimeout: 30000,
          },
        },
      },
    ]),
  ],
  controllers: [
    GatewayController,
    GatewayFilesystemController,
    GatewayAuthController,
    GatewayChatController,
    GatewayNotificationController
  ],
  providers: [GatewayService],
})
export class AppModule {}