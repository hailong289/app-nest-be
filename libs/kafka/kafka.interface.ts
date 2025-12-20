import {
  ConsumerConfig,
  KafkaConfig as KafkaJsConfig,
  ProducerConfig,
} from '@nestjs/microservices/external/kafka.interface';
import { SASLOptions } from 'kafkajs';

/**
 * Định nghĩa danh sách các Topics có sẵn.
 * Sửa ở đây để đồng bộ tên topic toàn hệ thống.
 */
export interface KafkaTopicNames {
  notification: string;
  email: string;
  sms: string;
  pushNotification: string;
  chat: string;
  user: string;
  [key: string]: string; // Cho phép mở rộng thêm topic lạ nếu cần gấp
}

/**
 * Cấu trúc config trả về từ file kafka.config.ts
 */
export type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512' | 'aws';
export interface SharedKafkaConfig {
  client: Omit<KafkaJsConfig, 'sasl'> & {
    sasl?: SASLOptions | undefined;
  }; // Config kết nối (Broker, Auth...)
  consumer: ConsumerConfig; // Config Consumer mặc định
  producer: ProducerConfig; // Config Producer mặc định
  topicNames: KafkaTopicNames; // Map tên topic
}

/**
 * Options input khi service con gọi registerAsync
 */
export interface SharedKafkaClientOptions {
  name: string; // Token để Inject (VD: 'NOTIFICATION_SERVICE')
  clientId?: string; // Tên định danh của Service (VD: 'auth-service')
  groupId?: string; // Group Consumer (VD: 'auth-consumer-group')
}
