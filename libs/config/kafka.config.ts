import { registerAs } from '@nestjs/config';

export default registerAs('kafka', () => {
  const isSasl =
    process.env.NODE_ENV === 'production' ||
    !!(process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD);

  return {
    // Broker configuration
    host: process.env.KAFKA_HOST || 'localhost',
    port: parseInt(process.env.KAFKA_PORT || '9092', 10),
    brokers:
      process.env.KAFKA_BROKERS ||
      process.env.KAFKA_BROKER ||
      `${process.env.KAFKA_HOST || 'localhost'}:${process.env.KAFKA_PORT || '9092'}`,

    // Client configuration
    clientId: process.env.KAFKA_CLIENT_ID || 'nestjs-app',
    groupId: process.env.KAFKA_GROUP_ID || 'nestjs-consumer-group',

    // SASL Authentication
    isSasl,
    sasl: isSasl
      ? {
          mechanism:
            (process.env.KAFKA_SASL_MECHANISM as
              | 'plain'
              | 'scram-sha-256'
              | 'scram-sha-512') || 'scram-sha-256',
          username: process.env.KAFKA_SASL_USERNAME || '',
          password: process.env.KAFKA_SASL_PASSWORD || '',
        }
      : undefined,

    // SSL configuration
    ssl:
      process.env.NODE_ENV === 'production'
        ? true
        : (process.env.KAFKA_SSL || '').toLowerCase() === 'true',

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
});
