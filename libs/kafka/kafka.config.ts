import { registerAs } from '@nestjs/config';
import { SharedKafkaConfig, SaslMechanism } from './kafka.interface';
import { SASLOptions } from '@nestjs/microservices/external/kafka.interface';

function parseBoolean(v?: string): boolean {
  return (v || '').trim().toLowerCase() === 'true';
}

export default registerAs('kafka', (): SharedKafkaConfig => {
  // 1. Xử lý Brokers
  // Logic ưu tiên: KAFKA_BROKERS > KAFKA_HOST:KAFKA_PORT
  const brokersEnv =
    process.env.KAFKA_BROKERS ||
    `${process.env.KAFKA_HOST || 'localhost'}:${process.env.KAFKA_PORT || '9092'}`;

  const brokers = brokersEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. Xử lý SASL (Bảo mật)
  const isSasl = parseBoolean(process.env.KAFKA_SASL);

  // Ép kiểu biến mechanism về đúng dạng union type
  const mechanism = (process.env.KAFKA_SASL_MECHANISM ||
    'scram-sha-256') as SaslMechanism;
  const username = process.env.KAFKA_SASL_USERNAME || '';
  const password = process.env.KAFKA_SASL_PASSWORD || '';

  // Validate nhẹ để tránh lỗi ngớ ngẩn lúc runtime
  if (isSasl) {
    if (!username || !password) {
      throw new Error(
        'KAFKA_SASL is enabled but missing KAFKA_SASL_USERNAME or KAFKA_SASL_PASSWORD',
      );
    }
  }

  // Cấu hình SASL object (Dùng double casting để bypass strict type check của KafkaJS)
  let saslConfig: SASLOptions | undefined = undefined;
  if (isSasl) {
    saslConfig = {
      mechanism,
      username,
      password,
    } as unknown as SASLOptions;
  }

  // 3. Xử lý SSL
  const ssl = parseBoolean(process.env.KAFKA_SSL);

  // 4. Return cấu trúc khớp với interface SharedKafkaConfig
  return {
    // Nhóm cấu hình Client (Kết nối)
    client: {
      clientId: process.env.KAFKA_CLIENT_ID || 'nestjs-app',
      brokers,
      ssl,
      sasl: saslConfig,
      connectionTimeout: parseInt(
        process.env.KAFKA_CONNECTION_TIMEOUT || '10000',
        10,
      ),
      requestTimeout: parseInt(
        process.env.KAFKA_REQUEST_TIMEOUT || '30000',
        10,
      ),
      retry: {
        initialRetryTime: 100,
        retries: parseInt(process.env.KAFKA_RETRIES || '8', 10),
        maxRetryTime: 30000,
        multiplier: 2,
      },
    },

    // Nhóm cấu hình Consumer
    consumer: {
      groupId: process.env.KAFKA_GROUP_ID || 'nestjs-consumer-group',
      sessionTimeout: parseInt(
        process.env.KAFKA_SESSION_TIMEOUT || '30000',
        10,
      ),
      heartbeatInterval: parseInt(
        process.env.KAFKA_HEARTBEAT_INTERVAL || '3000',
        10,
      ),
      rebalanceTimeout: parseInt(
        process.env.KAFKA_REBALANCE_TIMEOUT || '60000',
        10,
      ),
      allowAutoTopicCreation: parseBoolean(
        process.env.KAFKA_AUTO_CREATE_TOPICS,
      ),
    },

    // Nhóm cấu hình Producer
    producer: {
      allowAutoTopicCreation: parseBoolean(
        process.env.KAFKA_AUTO_CREATE_TOPICS,
      ),
      transactionTimeout: parseInt(
        process.env.KAFKA_TRANSACTION_TIMEOUT || '60000',
        10,
      ),
      idempotent: parseBoolean(process.env.KAFKA_IDEMPOTENT),
    },

    // Nhóm Topics Mapping
    topicNames: {
      notification: process.env.KAFKA_TOPIC_NOTIFICATION || 'notifications',
      email: process.env.KAFKA_TOPIC_EMAIL || 'emails',
      sms: process.env.KAFKA_TOPIC_SMS || 'sms',
      pushNotification:
        process.env.KAFKA_TOPIC_PUSH_NOTIFICATION || 'push-notifications',
      chat: process.env.KAFKA_TOPIC_CHAT || 'chat-messages',
      user: process.env.KAFKA_TOPIC_USER || 'user-events',
    },
  };
});
