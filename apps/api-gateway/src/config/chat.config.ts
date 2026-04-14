import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('chat', () => {
  const nodeEnv =
    process.env.GATEWAY_CHAT_NODE_ENV || process.env.NODE_ENV || 'local';

  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_CHAT_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
    );
  }

  // Production (Cloud Run): đọc trực tiếp từ process.env được inject
  // Local: load từ file .env.development
  let serviceEnv: Record<string, string> = {};
  if (nodeEnv === 'local') {
    const envPath = resolve(process.cwd(), 'apps/api-gateway/.env.development');
    const envConfig = config({ path: envPath, override: false });
    serviceEnv = envConfig.parsed || {};
  }

  const get = (key: string) => serviceEnv[key] || process.env[key];

  let protoPath: string =
    get('GATEWAY_CHAT_PROTO_PATH') || 'libs/grpc/chat.proto';

  if (!protoPath.includes('chat.proto')) {
    console.warn(
      `[chat.config] Invalid protoPath: ${protoPath}, using default: libs/grpc/chat.proto`,
    );
    protoPath = 'libs/grpc/chat.proto';
  }

  const configResult = {
    host: get('GATEWAY_CHAT_HOST') || 'localhost',
    port: get('GATEWAY_CHAT_PORT') || '5003',
    protoPath,
    nodeEnv,
  };

  console.log('[chat.config] Config result:', {
    ...configResult,
    protoPathType: typeof configResult.protoPath,
  });

  return configResult;
});
