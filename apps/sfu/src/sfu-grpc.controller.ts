import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type { types as MediasoupTypes } from 'mediasoup';
// Namespace imports: required because these classes appear in a decorated
// constructor signature and the project enables both `isolatedModules` and
// `emitDecoratorMetadata`. A plain `import { SfuRoomService }` would trigger
// "A type referenced in a decorated signature must be imported with
// 'import type' or a namespace import".
import * as RoomServiceModule from './room/sfu-room.service';
import * as TransportServiceModule from './transport/sfu-transport.service';

/**
 * gRPC controller exposing SfuRoomService + SfuTransportService methods
 * to apps/socket (Cloud Run). Mediasoup objects (RtpCapabilities,
 * IceCandidates, DtlsParameters, RtpParameters) are encoded as JSON strings
 * to keep the proto schema simple.
 */
@Controller()
export class SfuGrpcController {
  private readonly logger = new Logger(SfuGrpcController.name);

  constructor(
    private readonly roomService: RoomServiceModule.SfuRoomService,
    private readonly transportService: TransportServiceModule.SfuTransportService,
  ) {}

  // ===== Room lifecycle =====

  @GrpcMethod('SfuService', 'CreateRoom')
  async createRoom(data: { roomId: string }) {
    const room = await this.roomService.createRoom(data.roomId);
    return {
      roomId: room.id,
      rtpCapabilitiesJson: JSON.stringify(room.router.rtpCapabilities),
    };
  }

  @GrpcMethod('SfuService', 'JoinRoom')
  async joinRoom(data: { roomId: string; userId: string }) {
    const room = await this.roomService.joinRoom(data.roomId, data.userId);
    return {
      roomId: room.id,
      rtpCapabilitiesJson: JSON.stringify(room.router.rtpCapabilities),
    };
  }

  @GrpcMethod('SfuService', 'LeaveRoom')
  leaveRoom(data: { roomId: string; userId: string }) {
    this.roomService.leaveRoom(data.roomId, data.userId);
    return {};
  }

  @GrpcMethod('SfuService', 'RoomExists')
  roomExists(data: { roomId: string }) {
    return { exists: !!this.roomService.getRoom(data.roomId) };
  }

  // ===== Producer queries =====

  @GrpcMethod('SfuService', 'GetProducers')
  getProducers(data: { roomId: string; excludeUserId: string }) {
    const room = this.roomService.getRoom(data.roomId);
    const producers: Array<{
      producerId: string;
      userId: string;
      kind: string;
      appDataJson: string;
    }> = [];

    if (room) {
      room.participants.forEach((participant, pUserId) => {
        if (pUserId === data.excludeUserId) return;
        participant.producers.forEach((producer) => {
          if (!producer.closed) {
            // Forward appData (e.g. { source: "screen" }) so the FE can
            // pre-populate `screenProducerIds` BEFORE consuming the
            // producer. Without this, late-joiners route screen tracks
            // into the camera Map and the share doesn't show up
            // until the sharer toggles. Empty string for producers
            // created without appData (regular camera/mic).
            producers.push({
              producerId: producer.id,
              userId: pUserId,
              kind: producer.kind,
              appDataJson: producer.appData
                ? JSON.stringify(producer.appData)
                : '',
            });
          }
        });
      });
    }

    return { producers };
  }

  @GrpcMethod('SfuService', 'FindProducerOwner')
  findProducerOwner(data: { roomId: string; producerId: string }) {
    const room = this.roomService.getRoom(data.roomId);
    if (!room) return { userId: '' };

    let owner = '';
    room.participants.forEach((participant, pUserId) => {
      if (participant.producers.has(data.producerId)) {
        owner = pUserId;
      }
    });
    return { userId: owner };
  }

  // ===== Transport =====

  @GrpcMethod('SfuService', 'CreateWebRtcTransport')
  async createWebRtcTransport(data: {
    roomId: string;
    userId: string;
    direction: string;
  }) {
    const transport = await this.transportService.createWebRtcTransport(
      data.roomId,
      data.userId,
      data.direction as 'send' | 'recv',
    );
    return {
      transportId: transport.id,
      iceParametersJson: JSON.stringify(transport.iceParameters),
      iceCandidatesJson: JSON.stringify(transport.iceCandidates),
      dtlsParametersJson: JSON.stringify(transport.dtlsParameters),
    };
  }

  @GrpcMethod('SfuService', 'ConnectTransport')
  async connectTransport(data: {
    roomId: string;
    userId: string;
    transportId: string;
    dtlsParametersJson: string;
  }) {
    const dtlsParameters = JSON.parse(
      data.dtlsParametersJson,
    ) as MediasoupTypes.DtlsParameters;
    await this.transportService.connectTransport(
      data.roomId,
      data.userId,
      data.transportId,
      dtlsParameters,
    );
    return {};
  }

  // ===== Producer =====

  @GrpcMethod('SfuService', 'Produce')
  async produce(data: {
    roomId: string;
    userId: string;
    transportId: string;
    kind: string;
    rtpParametersJson: string;
    appDataJson: string;
  }) {
    const rtpParameters = JSON.parse(
      data.rtpParametersJson,
    ) as MediasoupTypes.RtpParameters;
    const appData = data.appDataJson
      ? (JSON.parse(data.appDataJson) as MediasoupTypes.AppData)
      : undefined;
    const producer = await this.transportService.produce(
      data.roomId,
      data.userId,
      data.transportId,
      data.kind as 'audio' | 'video',
      rtpParameters,
      appData,
    );
    return { producerId: producer.id };
  }

  @GrpcMethod('SfuService', 'PauseProducer')
  async pauseProducer(data: {
    roomId: string;
    userId: string;
    producerId: string;
  }) {
    await this.transportService.pauseProducer(
      data.roomId,
      data.userId,
      data.producerId,
    );
    return {};
  }

  @GrpcMethod('SfuService', 'ResumeProducer')
  async resumeProducer(data: {
    roomId: string;
    userId: string;
    producerId: string;
  }) {
    await this.transportService.resumeProducer(
      data.roomId,
      data.userId,
      data.producerId,
    );
    return {};
  }

  @GrpcMethod('SfuService', 'CloseProducer')
  closeProducer(data: { roomId: string; userId: string; producerId: string }) {
    this.transportService.closeProducer(
      data.roomId,
      data.userId,
      data.producerId,
    );
    return {};
  }

  // ===== Consumer =====

  @GrpcMethod('SfuService', 'PauseConsumer')
  async pauseConsumer(data: {
    roomId: string;
    userId: string;
    consumerId: string;
  }) {
    await this.transportService.pauseConsumer(
      data.roomId,
      data.userId,
      data.consumerId,
    );
    return {};
  }

  @GrpcMethod('SfuService', 'ResumeConsumer')
  async resumeConsumer(data: {
    roomId: string;
    userId: string;
    consumerId: string;
  }) {
    await this.transportService.resumeConsumer(
      data.roomId,
      data.userId,
      data.consumerId,
    );
    return {};
  }

  @GrpcMethod('SfuService', 'Consume')
  async consume(data: {
    roomId: string;
    userId: string;
    transportId: string;
    producerId: string;
    rtpCapabilitiesJson: string;
  }) {
    const rtpCapabilities = JSON.parse(
      data.rtpCapabilitiesJson,
    ) as MediasoupTypes.RtpCapabilities;
    const consumer = await this.transportService.consume(
      data.roomId,
      data.userId,
      data.transportId,
      data.producerId,
      rtpCapabilities,
    );
    return {
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParametersJson: JSON.stringify(consumer.rtpParameters),
    };
  }
}
