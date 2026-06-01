import { Module, Global } from '@nestjs/common';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayController } from './gateway.controller';
import { RedisModule } from 'libs/db/src/redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [GatewayService],
  controllers: [GatewayController],
  exports: [GatewayService, RedisModule],
})
export class GatewayModule {}
