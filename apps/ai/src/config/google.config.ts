import { registerAs } from '@nestjs/config';

export default registerAs('google', () => {
  return {
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.GOOGLE_MODEL ?? 'gemini-1.5-flash',
  };
});
