import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: (() => {
    const hostEnv = (process.env.REDIS_HOST || '').trim();
    const isDockerHost = hostEnv?.includes('redis');
    if (hostEnv && !isDockerHost) return hostEnv;
    if (process.env.NODE_ENV === 'production') return hostEnv || 'redis:6379';
    return 'localhost';
  })(),
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  ttl: parseInt(process.env.REDIS_TTL || '300', 10), // TTL mặc định 5 phút
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'chat:',
  url:
    process.env.REDIS_URL ||
    (() => {
      const passwordSegment = process.env.REDIS_PASSWORD
        ? `:${process.env.REDIS_PASSWORD}@`
        : '';
      const host = process.env.REDIS_HOST || 'localhost';
      const port = process.env.REDIS_PORT || '6379';
      return `redis://${passwordSegment}${host}:${port}`;
    })(),
}));
