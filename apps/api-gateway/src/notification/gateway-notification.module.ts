import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayNotificationController } from './gateway-notification.controller';
import { GatewayService } from '../gateway/gateway.service';
import { SharedKafkaClientModule } from 'libs/kafka';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import notificationGrpcConfig from '../config/notification-grpc.config';

@Module({
  imports: [
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION, // Token để inject (bắt buộc)
      clientId: 'notification-service', // Tên định danh (Optional - override mặc định)
      groupId: 'notification-consumer', // Group ID (Optional - override mặc định)
    }),
    ConfigModule.forFeature(notificationGrpcConfig),
    GrpcClientModule.registerAsync({
      name: 'NOTIFICATION_GRPC_SERVICE',
      configKey: 'notificationGrpc',
      packages: ['notification'],
    }),
  ],
  controllers: [GatewayNotificationController],
  providers: [GatewayService],
})
export class GatewayNotificationModule {}
