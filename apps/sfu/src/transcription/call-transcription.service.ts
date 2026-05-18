import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as NestConfig from '@nestjs/config';
import { RemoteSocketEmitter } from 'libs/ws/src';
import { REDISKEY } from '@app/constants/RedisKey';
import type { types as MediasoupTypes } from 'mediasoup';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PcmVadSegmenter } from './pcm-vad-segmenter';
import { WhisperRunnerService } from './whisper-runner.service';
import { AiTranslationClient } from './ai-translation.client';
import { ChatTranscriptClient } from './chat-transcript.client';
import type {
  PcmSegment,
  StartCallTranscriptionInput,
  StopCallTranscriptionInput,
  TranscriptPayload,
} from './transcription.types';
import type { SFURoom } from '../room/sfu-room.service';

type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;
type PlainTransport = MediasoupTypes.PlainTransport;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type RtpParameters = MediasoupTypes.RtpParameters;

interface CaptionWatcher {
  userId: string;
  targetLanguage?: string;
  sourceLanguage?: string;
}

interface ActiveCallSession {
  roomId: string;
  callId: string;
  watchers: Map<string, CaptionWatcher>;
  taps: Map<string, ProducerTap>;
}

interface ProducerTap {
  roomId: string;
  callId: string;
  speakerUserId: string;
  producerId: string;
  transport: PlainTransport;
  consumer: Consumer;
  ffmpeg: ChildProcessWithoutNullStreams;
  tempDir: string;
  segmenter: PcmVadSegmenter;
  queue: Promise<void>;
  closed: boolean;
}

@Injectable()
export class CallTranscriptionService implements OnModuleDestroy {
  private readonly logger = new Logger(CallTranscriptionService.name);
  private readonly sessions = new Map<string, ActiveCallSession>();
  private readonly key = REDISKEY;

  constructor(
    private readonly cfg: NestConfig.ConfigService,
    private readonly emitter: RemoteSocketEmitter,
    private readonly whisper: WhisperRunnerService,
    private readonly translator: AiTranslationClient,
    private readonly transcriptStore: ChatTranscriptClient,
  ) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.sessions.values()].map((session) => this.stopSession(session)),
    );
  }

  async startCall(
    input: StartCallTranscriptionInput,
    room?: SFURoom,
  ): Promise<{ enabled: boolean; roomId: string; callId: string }> {
    if (!this.cfg.get<boolean>('transcription.enabled')) {
      throw new ServiceUnavailableException('Call transcription is disabled');
    }

    const session = this.getOrCreateSession(input.roomId, input.callId);
    session.watchers.set(input.userId, {
      userId: input.userId,
      targetLanguage: this.normalizeTargetLanguage(input.targetLanguage),
      sourceLanguage: this.normalizeLanguage(input.sourceLanguage),
    });

    if (room) {
      await this.attachExistingAudioProducers(room, session);
    }

    return {
      enabled: true,
      roomId: input.roomId,
      callId: input.callId,
    };
  }

  async stopCall(
    input: StopCallTranscriptionInput,
  ): Promise<{ stopped: boolean; roomId: string; callId: string }> {
    const session = this.sessions.get(this.sessionKey(input.roomId, input.callId));
    if (!session) {
      return { stopped: false, roomId: input.roomId, callId: input.callId };
    }

    session.watchers.delete(input.userId);
    if (session.watchers.size === 0) {
      await this.stopSession(session);
    }

    return { stopped: true, roomId: input.roomId, callId: input.callId };
  }

  async maybeStartProducerTap(
    room: SFURoom,
    speakerUserId: string,
    producer: Producer,
  ): Promise<void> {
    if (producer.kind !== 'audio') return;
    const sessions = [...this.sessions.values()].filter(
      (session) => session.roomId === room.id && session.watchers.size > 0,
    );
    for (const session of sessions) {
      await this.startProducerTap(room, session, speakerUserId, producer);
    }
  }

  async stopUser(roomId: string, userId: string): Promise<void> {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.roomId === roomId,
    );
    for (const session of sessions) {
      const taps = [...session.taps.values()].filter(
        (tap) => tap.speakerUserId === userId,
      );
      for (const tap of taps) {
        await this.stopTap(session, tap.producerId);
      }
    }
  }

  async stopProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.roomId === roomId,
    );
    for (const session of sessions) {
      const tap = session.taps.get(producerId);
      if (tap?.speakerUserId === userId) {
        await this.stopTap(session, producerId);
      }
    }
  }

  async transcribeAudioUrl(input: {
    audioUrl: string;
    mimeType?: string;
    sourceLanguage?: string;
  }): Promise<{ transcript: string; detectedLanguage: string }> {
    return this.whisper.transcribeAudioUrl({
      audioUrl: input.audioUrl,
      mimeType: input.mimeType,
      sourceLanguage: input.sourceLanguage,
    });
  }

  private async attachExistingAudioProducers(
    room: SFURoom,
    session: ActiveCallSession,
  ): Promise<void> {
    const maxSpeakers = this.cfg.get<number>('transcription.maxSpeakers') || 4;
    for (const [userId, participant] of room.participants) {
      for (const producer of participant.producers.values()) {
        if (session.taps.size >= maxSpeakers) return;
        if (!producer.closed && producer.kind === 'audio') {
          await this.startProducerTap(room, session, userId, producer);
        }
      }
    }
  }

  private async startProducerTap(
    room: SFURoom,
    session: ActiveCallSession,
    speakerUserId: string,
    producer: Producer,
  ): Promise<void> {
    if (session.taps.has(producer.id)) return;
    const maxSpeakers = this.cfg.get<number>('transcription.maxSpeakers') || 4;
    if (session.taps.size >= maxSpeakers) {
      this.logger.warn(
        `[CALL_TRANSCRIPT] Max speakers reached for ${session.callId}`,
      );
      return;
    }

    let tempDir = '';
    let transport: PlainTransport | undefined;
    let consumer: Consumer | undefined;
    let ffmpeg: ChildProcessWithoutNullStreams | undefined;

    try {
      tempDir = await mkdtemp(join(tmpdir(), 'sfu-rtp-'));
      const rtpPort = await this.getFreeUdpPort();
      transport = await room.router.createPlainTransport({
        listenIp: '127.0.0.1',
        rtcpMux: true,
        comedia: false,
      });
      await transport.connect({ ip: '127.0.0.1', port: rtpPort });

      const rtpCapabilities = this.buildAudioRtpCapabilities(room);
      consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: false,
      });

      const sdpPath = join(tempDir, 'audio.sdp');
      await writeFile(
        sdpPath,
        this.buildSdp(rtpPort, consumer.rtpParameters),
        'utf8',
      );

      ffmpeg = this.spawnFfmpeg(sdpPath);
      const tap: ProducerTap = {
        roomId: room.id,
        callId: session.callId,
        speakerUserId,
        producerId: producer.id,
        transport,
        consumer,
        ffmpeg,
        tempDir,
        queue: Promise.resolve(),
        closed: false,
        segmenter: new PcmVadSegmenter({
          silenceMs: this.cfg.get<number>('transcription.silenceMs') || 1200,
          maxSegmentMs:
            this.cfg.get<number>('transcription.segmentMaxMs') || 8000,
          threshold: this.cfg.get<number>('transcription.vadThreshold') || 500,
          onSpeechStart: (startedAt) =>
            this.emitPartial(session, tap, startedAt),
          onSegment: (segment) => {
            tap.queue = tap.queue
              .then(() => this.processSegment(session, tap, segment))
              .catch((error) => this.emitTapError(session, tap, error));
          },
        }),
      };

      ffmpeg.stdout.on('data', (chunk: Buffer) => tap.segmenter.push(chunk));
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf8').trim();
        if (msg.includes('Error') || msg.includes('Invalid')) {
          this.logger.warn(`[FFMPEG:${producer.id}] ${msg}`);
        }
      });
      ffmpeg.on('close', () => {
        tap.segmenter.flush();
        void this.stopTap(session, producer.id);
      });
      producer.on('transportclose', () => {
        void this.stopTap(session, producer.id);
      });
      producer.observer.on('close', () => {
        void this.stopTap(session, producer.id);
      });

      session.taps.set(producer.id, tap);
      this.logger.log(
        `[CALL_TRANSCRIPT] Started tap room=${room.id} call=${session.callId} producer=${producer.id}`,
      );
    } catch (error) {
      if (consumer && !consumer.closed) consumer.close();
      if (transport && !transport.closed) transport.close();
      if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
      this.emitSessionError(session, error);
    }
  }

  private async processSegment(
    session: ActiveCallSession,
    tap: ProducerTap,
    segment: PcmSegment,
  ): Promise<void> {
    if (session.watchers.size === 0) return;

    const result = await this.whisper.transcribePcm({
      pcm: segment.pcm,
      sourceLanguage: this.primarySourceLanguage(session),
    });
    const text = result.transcript.trim();
    if (!text) return;

    const baseSegmentId = [
      session.callId,
      tap.speakerUserId,
      segment.startedAt.getTime(),
    ].join(':');

    for (const watcher of session.watchers.values()) {
      const targetLanguage = watcher.targetLanguage;
      let translatedText = '';
      if (targetLanguage) {
        translatedText = await this.translator.translate({
          text,
          from: result.detectedLanguage || watcher.sourceLanguage || 'auto',
          to: targetLanguage,
          userId: watcher.userId,
        });
      }

      const payload: TranscriptPayload = {
        roomId: session.roomId,
        callId: session.callId,
        speakerUserId: tap.speakerUserId,
        segmentId: `${baseSegmentId}:${targetLanguage || 'source'}`,
        sourceLanguage: result.detectedLanguage || watcher.sourceLanguage || '',
        targetLanguage,
        text,
        translatedText,
        isFinal: true,
        startedAt: segment.startedAt.toISOString(),
        endedAt: segment.endedAt.toISOString(),
      };

      this.emitToWatcher(watcher.userId, 'call:transcript:final', payload);
      await this.transcriptStore.save(payload);
    }
  }

  private emitPartial(
    session: ActiveCallSession,
    tap: ProducerTap,
    startedAt: Date,
  ): void {
    for (const watcher of session.watchers.values()) {
      const payload: TranscriptPayload = {
        roomId: session.roomId,
        callId: session.callId,
        speakerUserId: tap.speakerUserId,
        segmentId: [
          session.callId,
          tap.speakerUserId,
          startedAt.getTime(),
          watcher.targetLanguage || 'source',
        ].join(':'),
        sourceLanguage: watcher.sourceLanguage || '',
        targetLanguage: watcher.targetLanguage,
        text: '',
        translatedText: '',
        isFinal: false,
        startedAt: startedAt.toISOString(),
        endedAt: startedAt.toISOString(),
      };
      this.emitToWatcher(watcher.userId, 'call:transcript:partial', payload);
    }
  }

  private emitToWatcher(
    userId: string,
    event: string,
    payload: TranscriptPayload,
  ): void {
    this.emitter.broadcastTo(
      '/call',
      this.key.ROOM_CLIENT(userId),
      event,
      payload,
    );
  }

  private emitTapError(
    session: ActiveCallSession,
    tap: ProducerTap,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `[CALL_TRANSCRIPT] Tap failed call=${session.callId} producer=${tap.producerId}: ${message}`,
    );
    this.emitSessionError(session, error);
  }

  private emitSessionError(session: ActiveCallSession, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    for (const watcher of session.watchers.values()) {
      this.emitter.broadcastTo(
        '/call',
        this.key.ROOM_CLIENT(watcher.userId),
        'call:transcription:error',
        {
          roomId: session.roomId,
          callId: session.callId,
          message,
        },
      );
    }
  }

  private async stopSession(session: ActiveCallSession): Promise<void> {
    this.sessions.delete(this.sessionKey(session.roomId, session.callId));
    const taps = [...session.taps.keys()];
    for (const producerId of taps) {
      await this.stopTap(session, producerId);
    }
    session.watchers.clear();
  }

  private async stopTap(
    session: ActiveCallSession,
    producerId: string,
  ): Promise<void> {
    const tap = session.taps.get(producerId);
    if (!tap || tap.closed) return;
    session.taps.delete(producerId);
    tap.segmenter.flush();
    tap.closed = true;
    if (!tap.ffmpeg.killed) tap.ffmpeg.kill('SIGTERM');
    if (!tap.consumer.closed) tap.consumer.close();
    if (!tap.transport.closed) tap.transport.close();
    await rm(tap.tempDir, { recursive: true, force: true });
  }

  private getOrCreateSession(roomId: string, callId: string): ActiveCallSession {
    const key = this.sessionKey(roomId, callId);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        roomId,
        callId,
        watchers: new Map(),
        taps: new Map(),
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  private sessionKey(roomId: string, callId: string): string {
    return `${roomId}:${callId}`;
  }

  private primarySourceLanguage(session: ActiveCallSession): string | undefined {
    return [...session.watchers.values()].find((watcher) => watcher.sourceLanguage)
      ?.sourceLanguage;
  }

  private normalizeTargetLanguage(language?: string): string | undefined {
    const normalized = this.normalizeLanguage(language);
    if (!normalized) return undefined;
    const allow = this.cfg.get<string[]>('transcription.targetLanguages') || [];
    if (allow.length > 0 && !allow.includes(normalized)) {
      return undefined;
    }
    return normalized;
  }

  private normalizeLanguage(language?: string): string | undefined {
    const normalized = language?.trim().toLowerCase();
    if (!normalized || normalized === 'auto') return undefined;
    return normalized;
  }

  private buildAudioRtpCapabilities(room: SFURoom): RtpCapabilities {
    const codec = room.router.rtpCapabilities.codecs?.find(
      (item) =>
        item.kind === 'audio' &&
        String(item.mimeType).toLowerCase().includes('opus'),
    );
    if (!codec) {
      throw new Error('No Opus audio codec found in router RTP capabilities');
    }
    return {
      codecs: [codec],
      headerExtensions: [],
    };
  }

  private buildSdp(port: number, rtpParameters: RtpParameters): string {
    const codec = rtpParameters.codecs[0];
    if (!codec) {
      throw new Error('Consumer has no RTP codec');
    }

    const payloadType = codec.payloadType;
    const mimeType = codec.mimeType.split('/')[1] || 'opus';
    const clockRate = codec.clockRate || 48000;
    const channels = codec.channels || 2;
    const params = codec.parameters
      ? Object.entries(codec.parameters)
          .map(([key, value]) => `${key}=${value}`)
          .join(';')
      : '';

    return [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=appchat-sfu-transcription',
      'c=IN IP4 127.0.0.1',
      't=0 0',
      `m=audio ${port} RTP/AVP ${payloadType}`,
      `a=rtpmap:${payloadType} ${mimeType}/${clockRate}/${channels}`,
      params ? `a=fmtp:${payloadType} ${params}` : '',
      'a=recvonly',
      '',
    ]
      .filter((line) => line !== '')
      .join('\r\n');
  }

  private spawnFfmpeg(sdpPath: string): ChildProcessWithoutNullStreams {
    const ffmpegBin = this.cfg.get<string>('transcription.ffmpegBin') || 'ffmpeg';
    return spawn(
      ffmpegBin,
      [
        '-protocol_whitelist',
        'file,udp,rtp',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-analyzeduration',
        '0',
        '-probesize',
        '32',
        '-i',
        sdpPath,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { windowsHide: true },
    );
  }

  private getFreeUdpPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      socket.on('error', reject);
      socket.bind(0, '127.0.0.1', () => {
        const address = socket.address();
        const port = typeof address === 'string' ? 0 : address.port;
        socket.close(() => resolve(port));
      });
    });
  }
}
