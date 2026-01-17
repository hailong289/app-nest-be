import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('filesystem', () => {
  const nodeEnv = process.env.GATEWAY_FILESYSTEM_NODE_ENV || process.env.NODE_ENV || 'local';
  
  // Chỉ hợp pháp khi NODE_ENV là 'local' hoặc 'production'
  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_FILESYSTEM_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
    );
  }

  // Load file env tương ứng với NODE_ENV của service này
  const envFile = nodeEnv === 'local' ? 'development' : 'production';
  const envPath = resolve(process.cwd(), `apps/api-gateway/.env.${envFile}`);
  
  // Load file env riêng cho service này (không override process.env hiện tại)
  const envConfig = config({ path: envPath, override: false });
  const serviceEnv = envConfig.parsed || {};

  // Đọc giá trị từ file env tương ứng (ưu tiên file env của service này)
  return {
    host: serviceEnv.GATEWAY_FILESYSTEM_HOST || 'localhost',
    port: serviceEnv.GATEWAY_FILESYSTEM_PORT || '5002',
    protoPath: [
      serviceEnv.GATEWAY_FILESYSTEM_PROTO_PATH || 'libs/grpc/filesystem.proto',
      serviceEnv.GATEWAY_DOCUMENT_PROTO_PATH || 'libs/grpc/document.proto',
    ],
    nodeEnv,
    envFile,
  };
});

