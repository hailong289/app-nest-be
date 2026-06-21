import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { join } from 'node:path';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import * as grpc from '@grpc/grpc-js';
import { OnlineStatusTask } from '../tasks/online-status.task';
import type { SharedKafkaConfig } from 'libs/kafka/kafka.interface';
import { CHAT_KAFKA_PRODUCER } from './chat.tokens';

// Re-export để giữ tương thích nếu nơi khác còn import từ chat.module.
export { CHAT_KAFKA_PRODUCER };

@Module({
  imports: [
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
    // GỘP gRPC (SERVICES.CHAT) + Kafka producer (CHAT_KAFKA_PRODUCER) vào MỘT
    // ClientsModule.registerAsync. Lý do: import HAI ClientsModule riêng vào cùng
    // 1 module bị NestJS dedupe theo class → client thứ 2 (Kafka) bị bỏ →
    // CHAT_KAFKA_PRODUCER undefined. Một registerAsync với 2 entry thì cả 2 token
    // đều được provide cho ChatGateway.
    ClientsModule.registerAsync([
      {
        name: SERVICES.CHAT,
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            package: ['chat', 'social'],
            protoPath: join(
              process.cwd(),
              process.env.GATEWAY_CHAT_PROTO_PATH || 'libs/grpc/chat.proto',
            ),
            url: (() => {
              const host = (
                process.env.GATEWAY_CHAT_HOST || 'localhost'
              ).trim();
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
              includeDirs: [join(process.cwd(), 'libs/grpc')],
            },
          },
        }),
      },
      {
        name: CHAT_KAFKA_PRODUCER,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const kafkaConfig = configService.get<SharedKafkaConfig>('kafka');
          if (!kafkaConfig) {
            throw new Error(
              'Kafka config not found! Please import kafkaConfig into ConfigModule.',
            );
          }
          return {
            transport: Transport.KAFKA,
            options: {
              client: {
                ...kafkaConfig.client,
                clientId: 'socket-chat-inbound-producer',
              },
              consumer: {
                ...kafkaConfig.consumer,
                groupId: 'socket-chat-inbound-producer-group',
              },
              producer: kafkaConfig.producer,
            },
          };
        },
      },
    ]),
  ],
  controllers: [],
  providers: [ChatGateway, OnlineStatusTask],
  exports: [ChatGateway],
})
export class ChatWebSocketModule {}
