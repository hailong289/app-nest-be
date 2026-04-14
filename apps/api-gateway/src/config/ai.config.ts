import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('ai', () => {
  const nodeEnv =
    process.env.GATEWAY_AI_NODE_ENV || process.env.NODE_ENV || 'local';

  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_AI_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
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

  return {
    host: get('GATEWAY_AI_HOST') || 'localhost',
    port: get('GATEWAY_AI_PORT') || '5004',
    protoPath: get('GATEWAY_AI_PROTO_PATH') || 'libs/grpc/ai.proto',
    nodeEnv,
  };
});
