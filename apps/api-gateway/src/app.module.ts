import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayFilesystemController } from './filesystem/gateway-filesystem.controller';
import { GatewayAuthController } from './auth/gateway-auth.controller';
import { GatewayChatController } from './chat/gateway-chat.controller';
import { GatewayNotificationController } from './notification/gateway-notification.controller';
import { SERVICES, TRANSPORT_CONFIG } from '@app/constants';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: SERVICES.AUTH,
        transport: Transport.TCP,
        options: TRANSPORT_CONFIG.TCP.AUTH,
      },
      {
        name: SERVICES.CHAT,
        transport: Transport.TCP,
        options: TRANSPORT_CONFIG.TCP.CHAT,
      },
      {
        name: SERVICES.NOTIFICATION,
        transport: Transport.TCP,
        options: TRANSPORT_CONFIG.TCP.NOTIFICATION,
      },
      {
        name: SERVICES.FILESYSTEM,
        transport: Transport.KAFKA,
        options: TRANSPORT_CONFIG.KAFKA.FILESYSTEM as { client: any; consumer: any; producer: any },
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
export class AppModule {}