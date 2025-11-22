import { registerAs } from '@nestjs/config';

function parseBoolean(v?: string) {
  return (v || '').trim().toLowerCase() === 'true';
}

export default registerAs('kafka', () => {
  const brokersEnv =
    process.env.KAFKA_BROKERS ||
    process.env.KAFKA_BROKER ||
    `${process.env.KAFKA_HOST || 'localhost'}:${process.env.KAFKA_PORT || '9092'}`;

  const brokers = brokersEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // ✔ Bật/tắt SASL bằng flag rõ ràng
  const isSasl = parseBoolean(process.env.KAFKA_SASL);

  const mechanism =
    (process.env.KAFKA_SASL_MECHANISM as
      | 'plain'
      | 'scram-sha-256'
      | 'scram-sha-512'
      | undefined) || undefined;

  const username = process.env.KAFKA_SASL_USERNAME || '';
  const password = process.env.KAFKA_SASL_PASSWORD || '';

  if (isSasl) {
    if (!mechanism)
      throw new Error('KAFKA_SASL_MECHANISM is required when KAFKA_SASL=true');
    if (!username || !password)
      throw new Error(
        'KAFKA_SASL_USERNAME/PASSWORD are required when KAFKA_SASL=true',
      );
  }

  // ✔ SSL do bạn quyết định bằng env (đừng tự ép theo NODE_ENV)
  const ssl = parseBoolean(process.env.KAFKA_SSL);

  const kafkaConfig = {
    // Broker configuration
    brokers,
    host: process.env.KAFKA_HOST || 'localhost',
    port: parseInt(process.env.KAFKA_PORT || '9092', 10),

    // Client configuration
    clientId: process.env.KAFKA_CLIENT_ID || 'nestjs-app',
    groupId: process.env.KAFKA_GROUP_ID || 'nestjs-consumer-group',

    // SASL
    isSasl,
    sasl: isSasl
      ? {
          mechanism, // 'plain' | 'scram-sha-256' | 'scram-sha-512'
          username,
          password,
        }
      : undefined,

    // SSL
    ssl,

    // Connection configuration
    connectionTimeout: parseInt(
      process.env.KAFKA_CONNECTION_TIMEOUT || '10000',
      10,
    ),
    requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT || '30000', 10),

    // Retry configuration
    retry: {
      initialRetryTime: 100,
      retries: parseInt(process.env.KAFKA_RETRIES || '8', 10),
      maxRetryTime: 30000,
      multiplier: 2,
    },

    // Consumer configuration
    consumer: {
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
      allowAutoTopicCreation: process.env.KAFKA_AUTO_CREATE_TOPICS === 'true',
    },

    // Producer configuration
    producer: {
      allowAutoTopicCreation: process.env.KAFKA_AUTO_CREATE_TOPICS === 'true',
      transactionTimeout: parseInt(
        process.env.KAFKA_TRANSACTION_TIMEOUT || '60000',
        10,
      ),
      idempotent: process.env.KAFKA_IDEMPOTENT === 'true',
    },

    // Topics
    topics: {
      notification: process.env.KAFKA_TOPIC_NOTIFICATION || 'notifications',
      email: process.env.KAFKA_TOPIC_EMAIL || 'emails',
      sms: process.env.KAFKA_TOPIC_SMS || 'sms',
      pushNotification:
        process.env.KAFKA_TOPIC_PUSH_NOTIFICATION || 'push-notifications',
      chat: process.env.KAFKA_TOPIC_CHAT || 'chat-messages',
      user: process.env.KAFKA_TOPIC_USER || 'user-events',
    },
  };
  console.log('kafkaConfig', kafkaConfig);
  return kafkaConfig;
});
