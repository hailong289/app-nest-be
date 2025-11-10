import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayChatController } from './gateway-chat.controller';
import { GatewaySocialController } from './social/gateway-social.controller';
import { GatewayService } from '../gateway/gateway.service';
import { ChatWebSocketModule } from '../ws/chat/chat.module';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ChatWebSocketModule, // Import WebSocket module để có thể inject ChatGateway
    ClientsModule.register([
      {
        name: SERVICES.CHAT,
        transport: Transport.GRPC,
        options: {
          package: ['chat', 'social'],
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_CHAT_PROTO_PATH || 'libs/grpc/chat.proto',
          ),
          url: (() => {
            const hostEnv = (process.env.GATEWAY_CHAT_HOST || '').trim();
            const isDockerHost = hostEnv?.includes('chat');
            const host =
              isDockerHost && process.env.NODE_ENV !== 'production'
                ? 'localhost'
                : hostEnv || 'localhost';
            const port = process.env.GATEWAY_CHAT_PORT || '5003';
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
            defaults: false,
            oneofs: true,
            includeDirs: [
              join(process.cwd(), 'libs/grpc'), // chat.proto
              join(process.cwd(), 'libs/grpc'), // để resolve google/protobuf/struct.proto
            ],
          },
        },
      },
    ]),
  ],
  controllers: [GatewayChatController, GatewaySocialController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayChatModule {}
