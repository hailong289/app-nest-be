import { registerAs } from '@nestjs/config';

export default registerAs('mongodb', () => {
  const processEnv = process.env.NODE_ENV || 'local';
  const dbConfig = {
    connection:
      process.env[`DB_CONNECTION_${processEnv.toUpperCase()}`] || 'mongodb',
    host:
      process.env[`DB_HOST_${processEnv.toUpperCase()}`] || 'localhost:27017',
    name: process.env[`DB_NAME_${processEnv.toUpperCase()}`] || 'appchat',
    user: process.env[`DB_USER_${processEnv.toUpperCase()}`] || '',
    password: process.env[`DB_PASSWORD_${processEnv.toUpperCase()}`] || '',
  };
  return {
    uri: `mongodb://${dbConfig.user && dbConfig.password ? `${dbConfig.user}:${dbConfig.password}@` : ''}${dbConfig.host}/${dbConfig.name}?authSource=admin`,
  };
});
