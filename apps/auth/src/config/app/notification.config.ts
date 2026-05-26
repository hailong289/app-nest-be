import { registerAs } from '@nestjs/config';

export default registerAs('notification', () => ({
  host: process.env.AUTH_NOTIFICATION_HOST || 'localhost',
  port: process.env.AUTH_NOTIFICATION_PORT || '5005',
  protoPath: 'libs/grpc/notification.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
