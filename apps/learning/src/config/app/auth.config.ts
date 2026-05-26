import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  host: process.env.LEARNING_AUTH_HOST || 'localhost',
  port: process.env.LEARNING_AUTH_PORT || '5001',
  protoPath: 'libs/grpc/auth.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
