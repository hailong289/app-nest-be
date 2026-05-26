import { registerAs } from '@nestjs/config';

export default registerAs('notificationGrpc', () => ({
  host: process.env.CHAT_NOTIFICATION_HOST || 'localhost',
  port: process.env.CHAT_NOTIFICATION_PORT || '5005',
  protoPath: 'libs/grpc/notification.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
