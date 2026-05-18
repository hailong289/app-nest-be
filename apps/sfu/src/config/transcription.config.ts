import { registerAs } from '@nestjs/config';

const intFromEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export default registerAs('transcription', () => {
  const targetLanguages = (
    process.env.CALL_TRANSCRIPTION_TARGET_LANGUAGES || 'vi,en,ja,ko,zh'
  )
    .split(',')
    .map((lang) => lang.trim().toLowerCase())
    .filter(Boolean);

  return {
    enabled: process.env.CALL_TRANSCRIPTION_ENABLED !== 'false',
    whisperBin: process.env.WHISPER_CPP_BIN || '/opt/whisper.cpp/main',
    whisperModelPath:
      process.env.WHISPER_MODEL_PATH || '/models/ggml-base.bin',
    maxSpeakers: intFromEnv('CALL_TRANSCRIPTION_MAX_SPEAKERS', 4),
    segmentMaxMs: intFromEnv('CALL_TRANSCRIPTION_SEGMENT_MAX_MS', 8000),
    silenceMs: intFromEnv('CALL_TRANSCRIPTION_SILENCE_MS', 1200),
    vadThreshold: intFromEnv('CALL_TRANSCRIPTION_VAD_THRESHOLD', 500),
    whisperTimeoutMs: intFromEnv('CALL_TRANSCRIPTION_WHISPER_TIMEOUT_MS', 60000),
    ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
    targetLanguages,
  };
});
