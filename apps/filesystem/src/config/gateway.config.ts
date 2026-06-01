import { registerAs } from '@nestjs/config';

export default registerAs('gateway', () => ({
  url: process.env.GATEWAY_URL || 'http://localhost:5000',
  internalSecret: process.env.GATEWAY_INTERNAL_SECRET || '',
}));
