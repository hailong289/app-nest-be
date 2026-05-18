import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
// Namespace import: ConfigService is referenced as a constructor param type
// in a decorated class (@Injectable). With `isolatedModules` and
// `emitDecoratorMetadata` enabled, the compiler requires a namespace import
// (or `import type`, but ConfigService is needed as a runtime value for DI).
import * as NestConfig from '@nestjs/config';
// ClientGrpc is an interface — only used for typing; @Inject(SERVICES.SFU)
// provides the actual DI token, so a type-only import is sufficient.
import type { ClientGrpc } from '@nestjs/microservices';
import * as grpc from '@grpc/grpc-js';
import { firstValueFrom, Observable, timeout } from 'rxjs';
import { SERVICES } from '@app/constants/services';

/**
 * Producer info returned by GetProducers — kept generic to avoid pulling in
 * mediasoup types on the client side (apps/socket will run on Cloud Run
 * without mediasoup native binaries).
 *
 * `appData` is parsed from the wire's `appDataJson` (string in proto).
 * Most commonly contains `{ source: "screen" }` for screen-share
 * producers — used by FE to pre-flag the producer in
 * `screenProducerIds` so consume() routes the track to
 * `remoteScreenStreams` instead of `remoteStreams`.
 */
export interface RpcProducerInfo {
  producerId: string;
  userId: string;
  kind: string;
  appData?: Record<string, unknown>;
}

/**
 * Transport descriptor returned to the FE. Mediasoup-specific shapes
 * (iceParameters, iceCandidates, dtlsParameters) come back as plain objects
 * after JSON.parse — they're forwarded to the browser as-is.
 */
export interface RpcWebRtcTransport {
  transportId: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
}

export interface RpcConsumer {
  consumerId: string;
  producerId: string;
  kind: string;
  rtpParameters: unknown;
}

interface SfuServiceGrpc {
  CreateRoom(
    data: { roomId: string },
    metadata: grpc.Metadata,
  ): Observable<{ roomId: string; rtpCapabilitiesJson: string }>;

  JoinRoom(
    data: { roomId: string; userId: string },
    metadata: grpc.Metadata,
  ): Observable<{ roomId: string; rtpCapabilitiesJson: string }>;

  LeaveRoom(
    data: { roomId: string; userId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  RoomExists(
    data: { roomId: string },
    metadata: grpc.Metadata,
  ): Observable<{ exists: boolean }>;

  GetProducers(
    data: { roomId: string; excludeUserId: string },
    metadata: grpc.Metadata,
  ): Observable<{
    producers: Array<{
      producerId: string;
      userId: string;
      kind: string;
      appDataJson?: string;
    }>;
  }>;

  FindProducerOwner(
    data: { roomId: string; producerId: string },
    metadata: grpc.Metadata,
  ): Observable<{ userId: string }>;

  CreateWebRtcTransport(
    data: { roomId: string; userId: string; direction: string },
    metadata: grpc.Metadata,
  ): Observable<{
    transportId: string;
    iceParametersJson: string;
    iceCandidatesJson: string;
    dtlsParametersJson: string;
  }>;

  ConnectTransport(
    data: {
      roomId: string;
      userId: string;
      transportId: string;
      dtlsParametersJson: string;
    },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  Produce(
    data: {
      roomId: string;
      userId: string;
      transportId: string;
      kind: string;
      rtpParametersJson: string;
      appDataJson: string;
    },
    metadata: grpc.Metadata,
  ): Observable<{ producerId: string }>;

  PauseProducer(
    data: { roomId: string; userId: string; producerId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  ResumeProducer(
    data: { roomId: string; userId: string; producerId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  CloseProducer(
    data: { roomId: string; userId: string; producerId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  Consume(
    data: {
      roomId: string;
      userId: string;
      transportId: string;
      producerId: string;
      rtpCapabilitiesJson: string;
    },
    metadata: grpc.Metadata,
  ): Observable<{
    consumerId: string;
    producerId: string;
    kind: string;
    rtpParametersJson: string;
  }>;

  PauseConsumer(
    data: { roomId: string; userId: string; consumerId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  ResumeConsumer(
    data: { roomId: string; userId: string; consumerId: string },
    metadata: grpc.Metadata,
  ): Observable<Record<string, never>>;

  StartCallTranscription(
    data: {
      roomId: string;
      callId: string;
      userId: string;
      targetLanguage?: string;
      sourceLanguage?: string;
    },
    metadata: grpc.Metadata,
  ): Observable<{ enabled: boolean; roomId: string; callId: string }>;

  StopCallTranscription(
    data: { roomId: string; callId: string; userId: string },
    metadata: grpc.Metadata,
  ): Observable<{ stopped: boolean; roomId: string; callId: string }>;

  TranscribeAudioUrl(
    data: {
      audioUrl: string;
      mimeType?: string;
      sourceLanguage?: string;
      userId: string;
    },
    metadata: grpc.Metadata,
  ): Observable<{ transcript: string; detectedLanguage: string }>;
}

const RPC_TIMEOUT_MS = 5000;

@Injectable()
export class SfuRpcClient implements OnModuleInit {
  private readonly logger = new Logger(SfuRpcClient.name);
  private service!: SfuServiceGrpc;
  private internalSecret = '';

  constructor(
    @Inject(SERVICES.SFU) private readonly client: ClientGrpc,
    private readonly configService: NestConfig.ConfigService,
  ) {}

  onModuleInit() {
    this.service = this.client.getService<SfuServiceGrpc>('SfuService');
    this.internalSecret =
      this.configService.get<string>('sfu.internalSecret') || '';
    if (!this.internalSecret) {
      this.logger.warn(
        'SFU_INTERNAL_SECRET is empty — SFU RPC calls will be rejected by the SFU server',
      );
    }
  }

  // ===== Room lifecycle =====

  async createRoom(roomId: string): Promise<{ rtpCapabilities: unknown }> {
    const res = await this.invoke(
      this.service.CreateRoom({ roomId }, this.metadata()),
    );
    return { rtpCapabilities: JSON.parse(res.rtpCapabilitiesJson) };
  }

  async joinRoom(
    roomId: string,
    userId: string,
  ): Promise<{ rtpCapabilities: unknown }> {
    const res = await this.invoke(
      this.service.JoinRoom({ roomId, userId }, this.metadata()),
    );
    return { rtpCapabilities: JSON.parse(res.rtpCapabilitiesJson) };
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await this.invoke(
      this.service.LeaveRoom({ roomId, userId }, this.metadata()),
    );
  }

  async roomExists(roomId: string): Promise<boolean> {
    const res = await this.invoke(
      this.service.RoomExists({ roomId }, this.metadata()),
    );
    return res.exists;
  }

  // ===== Producer queries =====

  async getProducers(
    roomId: string,
    excludeUserId: string,
  ): Promise<RpcProducerInfo[]> {
    const res = await this.invoke(
      this.service.GetProducers({ roomId, excludeUserId }, this.metadata()),
    );
    // Parse wire-format `appDataJson` (string) into typed `appData`
    // (Record). Empty string means producer was created without
    // appData — we leave the field undefined so consumers don't need
    // to special-case "{}" vs missing.
    return (res.producers || []).map((p) => ({
      producerId: p.producerId,
      userId: p.userId,
      kind: p.kind,
      appData: p.appDataJson
        ? (this.safeJsonParse(p.appDataJson) as Record<string, unknown>)
        : undefined,
    }));
  }

  private safeJsonParse(s: string): unknown {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  }

  async findProducerOwner(
    roomId: string,
    producerId: string,
  ): Promise<string | undefined> {
    const res = await this.invoke(
      this.service.FindProducerOwner({ roomId, producerId }, this.metadata()),
    );
    return res.userId || undefined;
  }

  // ===== Transport =====

  async createWebRtcTransport(
    roomId: string,
    userId: string,
    direction: 'send' | 'recv',
  ): Promise<RpcWebRtcTransport> {
    const res = await this.invoke(
      this.service.CreateWebRtcTransport(
        { roomId, userId, direction },
        this.metadata(),
      ),
    );
    return {
      transportId: res.transportId,
      iceParameters: JSON.parse(res.iceParametersJson),
      iceCandidates: JSON.parse(res.iceCandidatesJson),
      dtlsParameters: JSON.parse(res.dtlsParametersJson),
    };
  }

  async connectTransport(
    roomId: string,
    userId: string,
    transportId: string,
    dtlsParameters: unknown,
  ): Promise<void> {
    await this.invoke(
      this.service.ConnectTransport(
        {
          roomId,
          userId,
          transportId,
          dtlsParametersJson: JSON.stringify(dtlsParameters),
        },
        this.metadata(),
      ),
    );
  }

  // ===== Producer =====

  async produce(
    roomId: string,
    userId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
    appData?: unknown,
  ): Promise<{ producerId: string }> {
    const res = await this.invoke(
      this.service.Produce(
        {
          roomId,
          userId,
          transportId,
          kind,
          rtpParametersJson: JSON.stringify(rtpParameters),
          appDataJson: appData ? JSON.stringify(appData) : '',
        },
        this.metadata(),
      ),
    );
    return { producerId: res.producerId };
  }

  async pauseProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    await this.invoke(
      this.service.PauseProducer(
        { roomId, userId, producerId },
        this.metadata(),
      ),
    );
  }

  async resumeProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    await this.invoke(
      this.service.ResumeProducer(
        { roomId, userId, producerId },
        this.metadata(),
      ),
    );
  }

  async closeProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    await this.invoke(
      this.service.CloseProducer(
        { roomId, userId, producerId },
        this.metadata(),
      ),
    );
  }

  // ===== Consumer =====

  async consume(
    roomId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<RpcConsumer> {
    const res = await this.invoke(
      this.service.Consume(
        {
          roomId,
          userId,
          transportId,
          producerId,
          rtpCapabilitiesJson: JSON.stringify(rtpCapabilities),
        },
        this.metadata(),
      ),
    );
    return {
      consumerId: res.consumerId,
      producerId: res.producerId,
      kind: res.kind,
      rtpParameters: JSON.parse(res.rtpParametersJson),
    };
  }

  async pauseConsumer(
    roomId: string,
    userId: string,
    consumerId: string,
  ): Promise<void> {
    await this.invoke(
      this.service.PauseConsumer(
        { roomId, userId, consumerId },
        this.metadata(),
      ),
    );
  }

  async resumeConsumer(
    roomId: string,
    userId: string,
    consumerId: string,
  ): Promise<void> {
    await this.invoke(
      this.service.ResumeConsumer(
        { roomId, userId, consumerId },
        this.metadata(),
      ),
    );
  }

  // ===== Call transcription =====

  async startCallTranscription(input: {
    roomId: string;
    callId: string;
    userId: string;
    targetLanguage?: string;
    sourceLanguage?: string;
  }): Promise<{ enabled: boolean; roomId: string; callId: string }> {
    return this.invoke(
      this.service.StartCallTranscription(
        {
          roomId: input.roomId,
          callId: input.callId,
          userId: input.userId,
          targetLanguage: input.targetLanguage || '',
          sourceLanguage: input.sourceLanguage || '',
        },
        this.metadata(),
      ),
    );
  }

  async stopCallTranscription(input: {
    roomId: string;
    callId: string;
    userId: string;
  }): Promise<{ stopped: boolean; roomId: string; callId: string }> {
    return this.invoke(
      this.service.StopCallTranscription(
        {
          roomId: input.roomId,
          callId: input.callId,
          userId: input.userId,
        },
        this.metadata(),
      ),
    );
  }

  async transcribeAudioUrl(input: {
    audioUrl: string;
    mimeType?: string;
    sourceLanguage?: string;
    userId: string;
  }): Promise<{ transcript: string; detectedLanguage: string }> {
    return this.invoke(
      this.service.TranscribeAudioUrl(
        {
          audioUrl: input.audioUrl,
          mimeType: input.mimeType || '',
          sourceLanguage: input.sourceLanguage || '',
          userId: input.userId,
        },
        this.metadata(),
      ),
    );
  }

  // ===== Helpers =====

  private metadata(): grpc.Metadata {
    const md = new grpc.Metadata();
    if (this.internalSecret) {
      md.set('x-internal-secret', this.internalSecret);
    }
    return md;
  }

  private async invoke<T>(obs$: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(obs$.pipe(timeout(RPC_TIMEOUT_MS)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SFU RPC failed: ${msg}`);
      throw new ServiceUnavailableException(`SFU unavailable: ${msg}`);
    }
  }
}
