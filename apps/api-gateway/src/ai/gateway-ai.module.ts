/*
https://docs.nestjs.com/modules
*/

import { SERVICES } from '@app/constants/services';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { GatewayAiController } from './gateway-ai.controller';
import { GatewayService } from '../services/gateway.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: SERVICES.AI,
        transport: Transport.GRPC,
        options: {
          package: 'ai',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_AI_PROTO_PATH || 'libs/grpc/ai.proto',
          ),
          url: `${process.env.GATEWAY_AI_HOST || 'localhost'}:${process.env.GATEWAY_AI_PORT || '5001'}`,
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
        },
      },
    ]),
  ],
  controllers: [GatewayAiController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAiModule {}
