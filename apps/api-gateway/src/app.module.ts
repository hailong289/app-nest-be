import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';

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
            brokers: ['kafka:9092'],
          },
          consumer: {
            groupId: 'filesystem-consumer',
          },
        },
      },
    ]),
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class AppModule {}