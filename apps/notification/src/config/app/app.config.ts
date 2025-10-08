import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  return {
    url_frontend: process.env.URL_FRONTEND,
  };
});
