import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => ({
  uri: (() => {
    const hostEnv = (process.env.DB_HOST || '').trim();
    console.log('DB_HOST:', hostEnv);
    const isDockerHostname = hostEnv && hostEnv.includes('mongodb');

    let host: string;
    if (hostEnv && !isDockerHostname) {
      host = hostEnv;
    } else if (process.env.NODE_ENV === 'production') {
      // In production prefer the provided host or the container hostname
      host = hostEnv || 'mongodb:27017';
    } else {
      // Local development fallback when a docker-only hostname is detected or none provided
      host = 'localhost:27017';
    }

    return (
      'mongodb://' +
      (process.env.DB_USER ? `${process.env.DB_USER}:` : '') +
      (process.env.DB_PASSWORD ? `${process.env.DB_PASSWORD}@` : '') +
      host
    );
  })(),
}));
