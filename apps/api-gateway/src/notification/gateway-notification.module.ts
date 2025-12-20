import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { GatewayNotificationController } from './gateway-notification.controller';
import { GatewayService } from '../gateway/gateway.service';
import { SharedKafkaClientModule } from 'libs/kafka';
import { join } from 'path';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION, // Token để inject (bắt buộc)
      clientId: 'notification-service', // Tên định danh (Optional - override mặc định)
      groupId: 'notification-consumer', // Group ID (Optional - override mặc định)
    }),
    ClientsModule.register([
      {
        name: 'NOTIFICATION_GRPC_SERVICE',
        transport: Transport.GRPC,
        options: {
          package: 'notification',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_NOTIFICATION_PROTO_PATH ||
              'libs/grpc/notification.proto',
          ),
          url: (() => {
            const host = process.env.GATEWAY_NOTIFICATION_HOST || 'localhost';
            const port = process.env.GATEWAY_NOTIFICATION_PORT || '5005';
            return `${host}:${port}`;
          })(),
          credentials:
            process.env.NODE_ENV === 'production'
              ? grpc.credentials.createSsl()
              : grpc.credentials.createInsecure(),
          loader: {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [join(process.cwd(), 'libs/grpc')],
          },
        },
      },
    ]),
  ],
  controllers: [GatewayNotificationController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayNotificationModule {}
