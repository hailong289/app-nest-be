import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: (() => {
    const hostEnv = (process.env.REDIS_HOST || '').trim();
    const isDockerHost = hostEnv?.includes('redis');
    if (hostEnv && !isDockerHost) return hostEnv;
    if (process.env.NODE_ENV === 'production') return hostEnv || 'redis:6379';
    return 'localhost';
  })(),
  port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number.parseInt(process.env.REDIS_DB || '0', 10),
  ttl: Number.parseInt(process.env.REDIS_TTL || '300', 10), // TTL mặc định 5 phút
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'chat:',
  url:
    process.env.REDIS_URL ||
    (() => {
      const usernameSegment = process.env.REDIS_USERNAME
        ? `${process.env.REDIS_USERNAME}:`
        : '';
      const passwordSegment = process.env.REDIS_PASSWORD || '';
      const authSegment =
        usernameSegment || passwordSegment
          ? `${usernameSegment}${passwordSegment}@`
          : '';
      const host = process.env.REDIS_HOST || 'localhost';
      const port = process.env.REDIS_PORT || '6379';
      return `redis://${authSegment}${host}:${port}`;
    })(),
}));
