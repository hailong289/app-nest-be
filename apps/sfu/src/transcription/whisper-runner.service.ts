import { Injectable, Logger } from '@nestjs/common';
import * as NestConfig from '@nestjs/config';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import axios from 'axios';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

@Injectable()
export class WhisperRunnerService {
  private readonly logger = new Logger(WhisperRunnerService.name);

  constructor(private readonly cfg: NestConfig.ConfigService) {}

  async transcribePcm(input: {
    pcm: Buffer;
    sourceLanguage?: string;
  }): Promise<{ transcript: string; detectedLanguage: string }> {
    const tempDir = await mkdtemp(join(tmpdir(), 'sfu-stt-'));
    try {
      const wavPath = join(tempDir, 'segment.wav');
      await writeFile(wavPath, this.pcmToWav(input.pcm));
      return await this.transcribeWavFile(wavPath, input.sourceLanguage, tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async transcribeAudioUrl(input: {
    audioUrl: string;
    mimeType?: string;
    sourceLanguage?: string;
  }): Promise<{ transcript: string; detectedLanguage: string }> {
    const tempDir = await mkdtemp(join(tmpdir(), 'sfu-stt-url-'));
    try {
      const inputPath = join(
        tempDir,
        `input${this.extensionForMime(input.mimeType)}`,
      );
      const wavPath = join(tempDir, 'input.wav');
      const response = await axios.get<ArrayBuffer>(input.audioUrl, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: 50 * 1024 * 1024,
      });
      await writeFile(inputPath, Buffer.from(response.data));

      await this.runProcess(
        this.cfg.get<string>('transcription.ffmpegBin') || 'ffmpeg',
        ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', wavPath],
        120_000,
      );

      return await this.transcribeWavFile(wavPath, input.sourceLanguage, tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async transcribeWavFile(
    wavPath: string,
    sourceLanguage: string | undefined,
    tempDir: string,
  ): Promise<{ transcript: string; detectedLanguage: string }> {
    const whisperBin =
      this.cfg.get<string>('transcription.whisperBin') ||
      '/opt/whisper.cpp/main';
    const modelPath =
      this.cfg.get<string>('transcription.whisperModelPath') ||
      '/models/ggml-base.bin';
    const outPrefix = join(tempDir, 'whisper-output');
    const language = this.normalizeLanguage(sourceLanguage);
    const args = [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-nt',
      '-otxt',
      '-of',
      outPrefix,
    ];
    if (language) {
      args.push('-l', language);
    }

    const result = await this.runProcess(
      whisperBin,
      args,
      this.cfg.get<number>('transcription.whisperTimeoutMs') || 60_000,
    );

    let transcript = '';
    try {
      transcript = (await readFile(`${outPrefix}.txt`, 'utf8')).trim();
    } catch {
      transcript = this.parseWhisperStdout(result.stdout);
    }

    return {
      transcript,
      detectedLanguage: language || 'auto',
    };
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        this.logger.warn(`${command} exited with code ${code}: ${stderr}`);
        reject(new Error(`${command} exited with code ${code}`));
      });
    });
  }

  private pcmToWav(pcm: Buffer): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
    const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);

    return Buffer.concat([header, pcm]);
  }

  private parseWhisperStdout(stdout: string): string {
    return stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, '').trim())
      .filter((line) => line && !line.startsWith('whisper_'))
      .join(' ')
      .trim();
  }

  private normalizeLanguage(language?: string): string {
    const normalized = language?.trim().toLowerCase();
    if (!normalized || normalized === 'auto') return '';
    return normalized;
  }

  private extensionForMime(mimeType?: string): string {
    if (!mimeType) return '.audio';
    if (mimeType.includes('webm')) return '.webm';
    if (mimeType.includes('ogg')) return '.ogg';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
    if (mimeType.includes('wav')) return '.wav';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
    const ext = extname(mimeType);
    return ext || '.audio';
  }
}
