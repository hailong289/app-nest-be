import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  host: process.env.NOTIFICATION_AUTH_HOST || '127.0.0.1',
  port: process.env.NOTIFICATION_AUTH_PORT || '5001',
  protoPath: 'libs/grpc/auth.proto',
  nodeEnv:
    process.env.NOTIFICATION_AUTH_NODE_ENV ||
    process.env.NODE_ENV ||
    'development',
}));
