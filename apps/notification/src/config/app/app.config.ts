import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  return {
    url_frontend: process.env.URL_FRONTEND || process.env.APP_URL_FRONTEND || 'https://app-chat-fe-service-534152738497.asia-southeast1.run.app',
  };
});
