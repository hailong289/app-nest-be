import { registerAs } from '@nestjs/config';

export default registerAs('kafka', () => {
  // Enable SASL if credentials are provided OR in production
  const isSasl =
    process.env.NODE_ENV === 'production' ||
    !!(process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD);

  return {
    host: process.env.KAFKA_HOST,
    port: process.env.KAFKA_PORT,
    client_id: process.env.KAFKA_CLIENT_ID,
    group_id: process.env.KAFKA_GROUP_ID,
    is_sasl: isSasl,
    mechanism: process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256',
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  };
});
