import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SERVICES } from '@app/constants';
import { GatewayChatController } from './gateway-chat.controller';
import { GatewaySocialController } from './social/gateway-social.controller';
import { GatewayService } from '../gateway/gateway.service';
import { GuestCallLinkService } from './guest-call-link.service';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import chatConfig from '../config/chat.config';

@Module({
  imports: [
    ConfigModule.forFeature(chatConfig),
    JwtModule.register({}),
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat', 'social'],
    }),
  ],
  controllers: [GatewayChatController, GatewaySocialController],
  providers: [GatewayService, GuestCallLinkService],
})
export class GatewayChatModule {}
