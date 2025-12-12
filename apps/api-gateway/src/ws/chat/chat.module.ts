import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { GatewayNotificationModule } from '../../notification/gateway-notification.module';
import { GatewayModule } from '../../gateway/gateway.module';
import { join } from 'node:path';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import notificationConfig from '../../config/notification.config';
import * as grpc from '@grpc/grpc-js';
@Module({
  imports: [
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
    GatewayNotificationModule, // Import để có thể inject ClientKafka
    GatewayModule, // Import để có thể inject GatewayService
    ConfigModule.forFeature(notificationConfig),
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
    ClientsModule.registerAsync([
      {
        name: SERVICES.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const clientId =
            config.get<string>('notification.client_id') || 'app-nest-be';
          const host = config.get<string>('notification.host') || 'localhost';
          const port = config.get<number>('notification.port') || 9092;
          const groupId =
            config.get<string>('notification.group_id') || 'default-group';
          const isSasl = config.get<boolean>('notification.is_sasl') ?? false;
          const mechanism =
            config.get<string>('notification.mechanism') || 'plain';
          const username = config.get<string>('notification.username');
          const password = config.get<string>('notification.password');

          const brokers = [`${host}:${port}`];
          const clientConfig: Record<string, unknown> = {
            clientId,
            brokers,
          };

          if (isSasl && username && password) {
            clientConfig.ssl = false;
            clientConfig.sasl = {
              mechanism,
              username,
              password,
            };
          }

          const options: Record<string, unknown> = {
            client: clientConfig,
            consumer: {
              groupId,
            },
          };
          return {
            transport: Transport.KAFKA,
            options,
          };
        },
      },
    ]),
  ],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatWebSocketModule {}
