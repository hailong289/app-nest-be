import { registerAs } from '@nestjs/config';

export default registerAs('notification', () => {
  const isSasl =
    process.env.GATEWAY_NOTI_KAFKA_SASL === 'true' ||
    process.env.NODE_ENV === 'production';
  return {
    host: process.env.GATEWAY_NOTI_KAFKA_HOST,
    port: process.env.GATEWAY_NOTI_KAFKA_PORT,
    client_id: process.env.GATEWAY_NOTI_KAFKA_CLIENT_ID,
    group_id: process.env.GATEWAY_NOTI_KAFKA_GROUP_ID,
    is_sasl: isSasl, // production
    mechanism: process.env.GATEWAY_NOTI_KAFKA_SASL_MECHANISM,
    username: process.env.GATEWAY_NOTI_KAFKA_SASL_USERNAME,
    password: process.env.GATEWAY_NOTI_KAFKA_SASL_PASSWORD,
  };
});
