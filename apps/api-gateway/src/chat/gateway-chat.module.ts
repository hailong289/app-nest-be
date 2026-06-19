import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayChatController } from './gateway-chat.controller';
import { GatewaySocialController } from './social/gateway-social.controller';
import { GatewayService } from '../gateway/gateway.service';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import chatConfig from '../config/chat.config';

@Module({
  imports: [
    ConfigModule.forFeature(chatConfig),
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat', 'social'],
    }),
  ],
  controllers: [GatewayChatController, GatewaySocialController],
  providers: [GatewayService],
})
export class GatewayChatModule {}
