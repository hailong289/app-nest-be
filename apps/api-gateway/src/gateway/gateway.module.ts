import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayController } from './gateway.controller';

@Module({
  providers: [GatewayService],
  controllers: [GatewayController],
})
export class GatewayModule {}
