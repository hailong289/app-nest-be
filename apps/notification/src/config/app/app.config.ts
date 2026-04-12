import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  return {
    url_frontend: process.env.APP_URL_FRONTEND,
  };
});
