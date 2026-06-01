import { registerAs } from '@nestjs/config';
import { config } from 'dotenv';
import { resolve } from 'path';

export default registerAs('learning', () => {
  const nodeEnv =
    process.env.GATEWAY_LEARNING_NODE_ENV || process.env.NODE_ENV || 'local';

  if (nodeEnv !== 'local' && nodeEnv !== 'production') {
    throw new Error(
      `Invalid GATEWAY_LEARNING_NODE_ENV: ${nodeEnv}. Must be 'local' or 'production'`,
    );
  }

  let serviceEnv: Record<string, string> = {};
  if (nodeEnv === 'local') {
    const envPath = resolve(process.cwd(), 'apps/api-gateway/.env.development');
    const envConfig = config({ path: envPath, override: false });
    serviceEnv = envConfig.parsed || {};
  }

  const get = (key: string) => serviceEnv[key] || process.env[key];

  return {
    host: get('GATEWAY_LEARNING_HOST') || 'localhost',
    port: get('GATEWAY_LEARNING_PORT') || '5007',
    protoPath: get('GATEWAY_LEARNING_PROTO_PATH') || 'libs/grpc/learning.proto',
    nodeEnv,
  };
});
