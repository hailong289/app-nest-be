import { registerAs } from '@nestjs/config';

export default registerAs('chat', () => ({
  host: process.env.GATEWAY_CHAT_HOST || process.env.CHAT_HOST || 'localhost',
  port: process.env.GATEWAY_CHAT_PORT || process.env.CHAT_PORT || '5003',
  protoPath: process.env.GATEWAY_CHAT_PROTO_PATH || 'libs/grpc/chat.proto',
  nodeEnv:
    process.env.GATEWAY_CHAT_NODE_ENV || process.env.NODE_ENV || 'local',
}));
