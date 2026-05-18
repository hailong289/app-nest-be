import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  host: process.env.GATEWAY_AI_HOST || process.env.AI_HOST || 'localhost',
  port: process.env.GATEWAY_AI_PORT || process.env.AI_PORT || '5004',
  protoPath: process.env.GATEWAY_AI_PROTO_PATH || 'libs/grpc/ai.proto',
  nodeEnv: process.env.GATEWAY_AI_NODE_ENV || process.env.NODE_ENV || 'local',
}));
