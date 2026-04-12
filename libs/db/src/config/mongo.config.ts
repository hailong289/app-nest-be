import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => ({
  dbName: process.env.DB_NAME,
  uri: (() => {
    const username = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const host = process.env.DB_HOST;

    return (
      'mongodb://' +
      (username ? username : '') +
      (password ? `:${password}@` : '') +
      host
    );
  })(),
}));
