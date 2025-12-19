import { Module } from '@nestjs/common';
import { SERVICES } from '@app/constants';
import { GatewayNotificationController } from './gateway-notification.controller';
import { GatewayService } from '../gateway/gateway.service';
import { SharedKafkaClientModule } from 'libs/kafka';

@Module({
  imports: [
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION, // Token để inject (bắt buộc)
      clientId: 'notification-service', // Tên định danh (Optional - override mặc định)
      groupId: 'notification-consumer', // Group ID (Optional - override mặc định)
    }),
  ],
  controllers: [GatewayNotificationController],
  providers: [GatewayService],
})
export class GatewayNotificationModule {}
