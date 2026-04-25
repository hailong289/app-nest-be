import { registerAs } from '@nestjs/config';

/**
 * Config for the SFU gRPC client.
 * apps/socket calls apps/sfu (deployed on a VM with public domain + SSL).
 *
 * In production:
 *   GATEWAY_SFU_HOST=sfu.your-domain.com
 *   GATEWAY_SFU_PORT=443
 *   GATEWAY_SFU_TLS=true
 *
 * In local dev:
 *   GATEWAY_SFU_HOST=localhost
 *   GATEWAY_SFU_PORT=5008
 *   GATEWAY_SFU_TLS=false
 */
export default registerAs('sfu', () => ({
  host: (process.env.GATEWAY_SFU_HOST || 'localhost').trim(),
  port: process.env.GATEWAY_SFU_PORT || '5008',
  tls: process.env.GATEWAY_SFU_TLS === 'true',
  protoPath: process.env.GATEWAY_SFU_PROTO_PATH || 'libs/grpc/sfu.proto',
  internalSecret: process.env.SFU_INTERNAL_SECRET || '',
}));
