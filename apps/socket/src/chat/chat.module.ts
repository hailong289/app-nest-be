import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { join } from 'node:path';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import * as grpc from '@grpc/grpc-js';
import { ChatConsumer } from './chat.consumer';
import { SharedBullModule } from 'libs/db/src';
import { OnlineStatusTask } from '../tasks/online-status.task';

@Module({
  imports: [
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
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
            const host = (process.env.GATEWAY_CHAT_HOST || 'localhost').trim();
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
            defaults: true,
            oneofs: true,
            includeDirs: [
              join(process.cwd(), 'libs/grpc'), // chat.proto
              join(process.cwd(), 'libs/grpc'), // để resolve google/protobuf/struct.proto
            ],
          },
        },
      },
    ]),
    SharedBullModule.registerQueue('room_updates'),
  ],
  controllers: [],
  providers: [ChatGateway, ChatConsumer, OnlineStatusTask],
  exports: [ChatGateway],
})
export class ChatWebSocketModule {}
