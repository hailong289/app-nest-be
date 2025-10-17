// kafka.module.ts
import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayNotificationController } from '../notification/gateway-notification.controller';
import { GatewayService } from '../gateway/gateway.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: 'notification-service',
              brokers: ['localhost:9092'],
            },
            consumer: {
              groupId: 'notification-consumer',
            },
          },
        }),
      },
    ]),
  ],
  controllers: [GatewayNotificationController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayNotificationModule {}
