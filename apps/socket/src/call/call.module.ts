import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import { SERVICES } from '@app/constants';
import { CallGateway } from './call.gateway';
import { SfuRpcModule } from '@app/sfu';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SharedBullModule } from 'libs/db/src';
import {
  CALL_AUTO_MISS_QUEUE,
  CallAutoMissProcessor,
} from './call-auto-miss.processor';

@Module({
  imports: [
    // SFU operations are delegated via gRPC to apps/sfu (mediasoup VM).
    // No mediasoup native binary is loaded in this app (Cloud Run friendly).
    SfuRpcModule.register(),
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
    // Distributed delayed-job queue for the server-side auto-miss timer.
    // Replaces in-process setTimeout so the timer survives pod restarts
    // and is safe under multi-pod Cloud Run autoscale.
    SharedBullModule.registerQueue(CALL_AUTO_MISS_QUEUE),
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
  ],
  providers: [CallGateway, CallAutoMissProcessor],
  exports: [CallGateway],
})
export class CallWebSocketModule {}
