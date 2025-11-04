import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { GatewayNotificationModule } from '../../notification/gateway-notification.module';
import { GatewayModule } from '../../gateway/gateway.module';
import { join } from 'node:path';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
    GatewayNotificationModule, // Import để có thể inject ClientKafka
    GatewayModule, // Import để có thể inject GatewayService
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
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatWebSocketModule {}
