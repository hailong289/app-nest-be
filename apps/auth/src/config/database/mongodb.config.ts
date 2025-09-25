
import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => ({
  uri: 'mongodb://' +
    (process.env.DB_USER ? `${process.env.DB_USER}:` : '') +
    (process.env.DB_PASSWORD ? `${process.env.DB_PASSWORD}@` : '') +
    (process.env.DB_HOST || 'localhost'),
}));