import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('auth', () => {
  const nodeEnv =
    process.env.GATEWAY_AUTH_NODE_ENV || process.env.NODE_ENV || 'local';

  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_AUTH_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
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

  const configResult = {
    host: get('GATEWAY_AUTH_HOST') || 'localhost',
    port: get('GATEWAY_AUTH_PORT') || '5001',
    protoPath: get('GATEWAY_AUTH_PROTO_PATH') || 'libs/grpc/auth.proto',
    nodeEnv,
  };

  console.log('[auth.config] Config result:', {
    ...configResult,
    protoPathType: typeof configResult.protoPath,
  });

  return configResult;
});
