import type { PcmSegment } from './transcription.types';

export interface PcmVadSegmenterOptions {
  silenceMs: number;
  maxSegmentMs: number;
  threshold: number;
  onSpeechStart?: (startedAt: Date) => void;
  onSegment: (segment: PcmSegment) => void;
}

const PCM_SAMPLE_RATE = 16000;
const PCM_BYTES_PER_SAMPLE = 2;

export class PcmVadSegmenter {
  private readonly chunks: Buffer[] = [];
  private inSpeech = false;
  private segmentStartedAt: Date | null = null;
  private lastVoiceAt = 0;
  private bufferedMs = 0;

  constructor(private readonly options: PcmVadSegmenterOptions) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;

    const now = Date.now();
    const chunkMs =
      (chunk.length / PCM_BYTES_PER_SAMPLE / PCM_SAMPLE_RATE) * 1000;
    const voiced = this.rms(chunk) >= this.options.threshold;

    if (voiced && !this.inSpeech) {
      this.inSpeech = true;
      this.segmentStartedAt = new Date(now);
      this.bufferedMs = 0;
      this.chunks.length = 0;
      this.options.onSpeechStart?.(this.segmentStartedAt);
    }

    if (this.inSpeech) {
      this.chunks.push(chunk);
      this.bufferedMs += chunkMs;
    }

    if (voiced) {
      this.lastVoiceAt = now;
    }

    if (!this.inSpeech) return;

    const silenceElapsed = now - this.lastVoiceAt;
    if (
      this.bufferedMs >= this.options.maxSegmentMs ||
      silenceElapsed >= this.options.silenceMs
    ) {
      this.finalize(new Date(now));
    }
  }

  flush(): void {
    if (this.inSpeech) {
      this.finalize(new Date());
    }
  }

  private finalize(endedAt: Date): void {
    const pcm = Buffer.concat(this.chunks);
    const startedAt = this.segmentStartedAt || endedAt;
    this.chunks.length = 0;
    this.inSpeech = false;
    this.segmentStartedAt = null;
    this.lastVoiceAt = 0;
    this.bufferedMs = 0;

    if (pcm.length < PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * 0.25) {
      return;
    }

    this.options.onSegment({ pcm, startedAt, endedAt });
  }

  private rms(chunk: Buffer): number {
    let sum = 0;
    let samples = 0;

    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const sample = chunk.readInt16LE(i);
      sum += sample * sample;
      samples += 1;
    }

    if (samples === 0) return 0;
    return Math.sqrt(sum / samples);
  }
}
