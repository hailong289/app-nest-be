import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SharedKafkaClientOptions, SharedKafkaConfig } from './kafka.interface';

@Module({})
export class SharedKafkaClientModule {
  static registerAsync(options: SharedKafkaClientOptions): DynamicModule {
    return {
      module: SharedKafkaClientModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name: options.name,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
              // Lấy config gốc từ libs (đã validate ở bước 2)
              const kafkaConfig = configService.get<SharedKafkaConfig>('kafka');

              if (!kafkaConfig) {
                throw new Error(
                  'Kafka config not found! Please import kafkaConfig into ConfigModule.',
                );
              }

              console.log('kafkaConfig', kafkaConfig);

              // Merge config gốc với config riêng của từng service
              return {
                transport: Transport.KAFKA,
                options: {
                  client: {
                    ...kafkaConfig.client,
                    // Override Client ID nếu có
                    clientId: options.clientId || kafkaConfig.client.clientId,
                  },
                  consumer: {
                    ...kafkaConfig.consumer,
                    // Override Group ID (QUAN TRỌNG)
                    groupId: options.groupId || kafkaConfig.consumer.groupId,
                    sessionTimeout:
                      kafkaConfig.consumer.sessionTimeout || 60000, // Tăng lên 60s (mặc định 30s)
                    heartbeatInterval:
                      kafkaConfig.consumer.heartbeatInterval || 20000, // Tăng lên 20s (mặc định 3s - phải nhỏ hơn sessionTimeout)
                  },
                  producer: kafkaConfig.producer,
                },
              };
            },
          },
        ]),
      ],
      exports: [ClientsModule], // Export ra để service con có thể Inject được ClientProxy
    };
  }
}
