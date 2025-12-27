import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayChatController } from './gateway-chat.controller';
import { GatewaySocialController } from './social/gateway-social.controller';
import { GatewayService } from '../gateway/gateway.service';
import { ChatWebSocketModule } from '../ws/chat/chat.module';
import * as grpc from '@grpc/grpc-js';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ChatWebSocketModule, // Import WebSocket module để có thể inject ChatGateway
    ClientsModule.registerAsync([
      {
        name: SERVICES.CHAT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: ['chat', 'social'],
            protoPath: join(process.cwd(), 'libs/grpc/chat.proto'),
            url: (() => {
              const host =
                configService.get<string>('GATEWAY_CHAT_HOST') || 'localhost';
              const port =
                configService.get<string>('GATEWAY_CHAT_PORT') || '5003';
              return `${host}:${port}`;
            })(),
            credentials:
              configService.get<string>('NODE_ENV') === 'production'
                ? grpc.credentials.createSsl()
                : grpc.credentials.createInsecure(),
            loader: {
              keepCase: true,
              longs: String,
              enums: String,
              defaults: true,
              oneofs: true,
              includeDirs: [
                join(process.cwd(), 'libs/grpc'), // chat.proto
                join(process.cwd(), 'libs/grpc'), // để resolve google/protobuf/struct.proto
              ],
            },
          },
        }),
      },
    ]),
  ],
  controllers: [GatewayChatController, GatewaySocialController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayChatModule {}
