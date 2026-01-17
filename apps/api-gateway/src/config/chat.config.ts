import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('chat', () => {
  const nodeEnv =
    process.env.GATEWAY_CHAT_NODE_ENV || process.env.NODE_ENV || 'local';

  // Chỉ hợp pháp khi NODE_ENV là 'local' hoặc 'production'
  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_CHAT_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
    );
  }

  // Load file env tương ứng với NODE_ENV của service này
  const envFile = nodeEnv === 'local' ? 'development' : 'production';
  const envPath = resolve(process.cwd(), `apps/api-gateway/.env.${envFile}`);
  const envConfig = config({ path: envPath, override: false });
  const serviceEnv = envConfig.parsed || {};
  let protoPath: string =
    serviceEnv.GATEWAY_CHAT_PROTO_PATH || 'libs/grpc/chat.proto';

  // Validate: nếu protoPath không chứa 'chat.proto', dùng giá trị mặc định
  if (!protoPath.includes('chat.proto')) {
    console.warn(
      `[chat.config] Invalid protoPath: ${protoPath}, using default: libs/grpc/chat.proto`,
    );
    protoPath = 'libs/grpc/chat.proto';
  }

  const configResult = {
    host: serviceEnv.GATEWAY_CHAT_HOST || 'localhost',
    port: serviceEnv.GATEWAY_CHAT_PORT || '5003',
    protoPath,
    nodeEnv,
    envFile,
  };

  console.log('[chat.config] Config result:', {
    ...configResult,
    protoPathType: typeof configResult.protoPath,
  });

  return configResult;
});
