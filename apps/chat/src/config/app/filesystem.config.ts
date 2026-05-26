import { registerAs } from '@nestjs/config';

export default registerAs('filesystem', () => ({
  host: process.env.CHAT_FILESYSTEM_HOST || 'localhost',
  port: process.env.CHAT_FILESYSTEM_PORT || '5002',
  protoPath: 'libs/grpc/filesystem.proto',
  nodeEnv: process.env.NODE_ENV || 'development',
}));
