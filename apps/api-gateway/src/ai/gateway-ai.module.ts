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
import { GatewayQuizzController } from './quizz/gateway-quizz.controller';
import { GatewayFlashcardController } from './flashcard/gateway-flashcard.controller';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.AI,
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            package: ['ai', 'quizz', 'flashcard'],
            protoPath: join(process.cwd(), 'libs/grpc/ai.proto'),
            url: (() => {
              const host = (process.env.GATEWAY_AI_HOST || 'localhost').trim();
              const port = process.env.GATEWAY_AI_PORT || '5004';
              return `${host}:${port}`;
            })(),
            credentials:
              process.env.NODE_ENV === 'production'
                ? grpc.credentials.createSsl()
                : grpc.credentials.createInsecure(),
            loader: {
              keepCase: true,
              longs: String,
              enums: String,
              defaults: true,
              oneofs: true,
              includeDirs: [join(process.cwd(), 'libs/grpc')],
            },
          },
        }),
      },
    ]),
  ],
  controllers: [
    GatewayAiController,
    GatewayQuizzController,
    GatewayFlashcardController,
  ],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAiModule {}
