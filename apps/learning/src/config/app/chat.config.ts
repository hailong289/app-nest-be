import { registerAs } from '@nestjs/config';

export default registerAs('chat', () => ({
  host: process.env.LEARNING_CHAT_HOST || 'localhost',
  port: process.env.LEARNING_CHAT_PORT || '5003',
  protoPath: 'libs/grpc/chat.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
