import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { GatewayNotificationModule } from '../../notification/gateway-notification.module';
import { GatewayModule } from '../../gateway/gateway.module';
import { join } from 'node:path';
import { ClientsModule, KafkaOptions, Transport } from '@nestjs/microservices';
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
    ClientsModule.registerAsync([
      {
        name: SERVICES.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const client_id = config.get('notification.client_id');
          const host = config.get('notification.host');
          const port = config.get('notification.port');
          const group_id = config.get('notification.group_id');
          const isSasl = config.get('notification.is_sasl');
          const mechanism = config.get('notification.mechanism');
          const username = config.get('notification.username');
          const password = config.get('notification.password');
          const options: KafkaOptions['options'] = {
            client: {
              clientId: client_id,
              brokers: [`${host}:${port}`],
            },
            consumer: {
              groupId: group_id,
            },
          };

          if (isSasl) {
            options.client = {
              ...options.client,
              ssl: false,
              sasl: {
                mechanism: mechanism,
                username: username,
                password: password,
              },
              brokers: options.client?.brokers || [`${host}:${port}`],
            };
          }

          console.log('options kafka', options);
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
