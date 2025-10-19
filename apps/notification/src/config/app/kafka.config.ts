import { registerAs } from '@nestjs/config';

export default registerAs('kafka', () => {
  const isSasl = process.env.NODE_ENV === 'production' ? true : false;
  return {
    host: process.env.KAFKA_HOST,
    port: process.env.KAFKA_PORT,
    client_id: process.env.KAFKA_CLIENT_ID,
    group_id: process.env.KAFKA_GROUP_ID,
    is_sasl: isSasl, // production
    mechanism: process.env.KAFKA_SASL_MECHANISM,
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  };
});
