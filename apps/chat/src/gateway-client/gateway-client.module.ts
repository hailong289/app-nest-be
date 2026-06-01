import { Global, Module } from '@nestjs/common';
import { GatewayClientService } from './gateway-client.service';

@Global()
@Module({
  providers: [GatewayClientService],
  exports: [GatewayClientService],
})
export class GatewayClientModule {}
