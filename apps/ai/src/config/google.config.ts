import { registerAs } from '@nestjs/config';

export default registerAs('google', () => {
  return {
    apiKey: process.env.GOOGLE_API_KEY,
    /** Default model for text-only AI features (suggest, summary, ...) */
    model: process.env.GOOGLE_MODEL ?? 'gemini-2.5-flash-lite',
    /**
     * Dedicated model for audio inputs (Speech-to-Text). Lite Gemini
     * variants frequently reject inlineData audio with a misleading
     * `API_KEY_INVALID` response, so we use the full flash model here
     * regardless of `GOOGLE_MODEL`.
     */
    audioModel: process.env.GOOGLE_AUDIO_MODEL ?? 'gemini-2.5-flash-lite',
  };
});
