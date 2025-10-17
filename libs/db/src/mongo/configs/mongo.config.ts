import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => ({
  uri: (() => {
    // If running locally (not in Docker), the hostname `mongodb` may not resolve.
    // Provide a sensible fallback to localhost:27017 for development convenience.
    const hostEnv = (process.env.DB_HOST || '').trim();

    // Treat any DB_HOST that contains the literal 'mongodb' as a docker-only hostname.
    // When running locally (NODE_ENV !== 'production') fall back to localhost:27017
    // to avoid DNS resolution errors like getaddrinfo ENOTFOUND mongodb.
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
