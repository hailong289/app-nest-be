import { registerAs } from '@nestjs/config';

export default registerAs('sfu', () => ({
  host: process.env.GATEWAY_SFU_HOST || process.env.SFU_HOST || 'localhost',
  port: process.env.GATEWAY_SFU_PORT || process.env.SFU_PORT || '5008',
  protoPath: process.env.GATEWAY_SFU_PROTO_PATH || 'libs/grpc/sfu.proto',
  nodeEnv: process.env.GATEWAY_SFU_NODE_ENV || process.env.NODE_ENV || 'local',
}));
