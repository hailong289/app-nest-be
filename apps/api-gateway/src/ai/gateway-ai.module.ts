/*
https://docs.nestjs.com/modules
*/

import { SERVICES } from '@app/constants/services';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import * as grpc from '@grpc/grpc-js';
import { GatewayAiController } from './gateway-ai.controller';
import { GatewayService } from '../gateway/gateway.service';

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
          url: `${process.env.GATEWAY_AI_HOST || 'localhost'}:${process.env.GATEWAY_AI_PORT || '5004'}`,
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
          maxReceiveMessageLength: 500 * 1024 * 1024, // 500MB
          maxSendMessageLength: 500 * 1024 * 1024, // 500MB
          channelOptions: {
            'grpc.keepalive_time_ms': 30000,
            'grpc.keepalive_timeout_ms': 5000,
            'grpc.keepalive_permit_without_calls': 1,
            'grpc.http2.max_pings_without_data': 0,
            'grpc.http2.min_time_between_pings_ms': 10000,
            'grpc.http2.min_ping_interval_without_data_ms': 300000,
            'grpc.http2.max_frame_size': 16777215, // 16MB
          },
        },
      },
    ]),
  ],
  controllers: [GatewayAiController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAiModule {}
