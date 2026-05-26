import { registerAs } from '@nestjs/config';

export default registerAs('chat', () => ({
  host: process.env.AI_CHAT_HOST || 'localhost',
  port: process.env.AI_CHAT_PORT || '5003',
  protoPath: 'libs/grpc/chat.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
