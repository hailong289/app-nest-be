import { Module } from '@nestjs/common';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayController } from './gateway.controller';

@Module({
  providers: [GatewayService],
  controllers: [GatewayController],
  exports: [GatewayService],
})
export class GatewayModule {}
