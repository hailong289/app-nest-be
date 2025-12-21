/*
https://docs.nestjs.com/modules
*/

import { SERVICES } from '@app/constants/services';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { GatewayAiController } from './gateway-ai.controller';
import { GatewayService } from '../gateway/gateway.service';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.AI,
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'ai',
            protoPath: join(
              process.cwd(),
              configService.get<string>('GATEWAY_AI_PROTO_PATH') ||
                'libs/grpc/ai.proto',
            ),
            url: `${configService.get<string>('GATEWAY_AI_HOST') || 'localhost'}:${configService.get<string>('GATEWAY_AI_PORT') || '5004'}`,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [GatewayAiController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAiModule {}
