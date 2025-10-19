import { Module } from '@nestjs/common';
import { ClientsModule, KafkaOptions, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayNotificationController } from './gateway-notification.controller';
import { GatewayService } from '../gateway/gateway.service';
import notificationConfig from '../config/notification.config';

@Module({
  imports: [
    ConfigModule.forFeature(notificationConfig),
    ClientsModule.registerAsync([
      {
        name: SERVICES.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const client_id = config.get('notification.client_id');
          const host = config.get('notification.host');
          const port = config.get('notification.port');
          const group_id = config.get('notification.group_id');
          const isSasl = config.get('notification.is_sasl');
          const mechanism = config.get('notification.mechanism');
          const username = config.get('notification.username');
          const password = config.get('notification.password');
          const options: KafkaOptions['options'] = {
            client: {
              clientId: client_id,
              brokers: [`${host}:${port}`],
            },
            consumer: {
              groupId: group_id,
            },
          };

          if (isSasl) {
            options.client = {
              ...options.client,
              ssl: false,
              sasl: {
                mechanism: mechanism,
                username: username,
                password: password,
              },
              brokers: options.client?.brokers || [`${host}:${port}`], // Ensure brokers is always defined
            };
          }

          console.log('options kafka', options);
          return {
            transport: Transport.KAFKA,
            options,
          };
        },
      },
    ]),
  ],
  controllers: [GatewayNotificationController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayNotificationModule {}
