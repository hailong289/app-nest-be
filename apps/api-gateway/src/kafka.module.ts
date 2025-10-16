// kafka.module.ts
import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { KafkaService } from './kafka.service';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.FILESYSTEM,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: 'filesystem-service',
              brokers: ['localhost:9092'],
            },
            consumer: {
              groupId: 'filesystem-consumer',
            },
          },
        }),
      },
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
  providers: [KafkaService],
  exports: [KafkaService, ClientsModule],
})
export class KafkaClientModule {}
