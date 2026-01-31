import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { types as MediasoupTypes } from 'mediasoup';
import { SfuRoomService } from '../room/sfu-room.service';
import { mediasoupConfig } from '../config/mediasoup.config';

type WebRtcTransport = MediasoupTypes.WebRtcTransport;
type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;
type DtlsParameters = MediasoupTypes.DtlsParameters;
type RtpParameters = MediasoupTypes.RtpParameters;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type AppData = MediasoupTypes.AppData;

@Injectable()
export class SfuTransportService {
  private readonly logger = new Logger(SfuTransportService.name);

  constructor(private readonly sfuRoomService: SfuRoomService) {}

  async createWebRtcTransport(
    roomId: string,
    userId: string,
    direction: 'send' | 'recv',
  ): Promise<WebRtcTransport> {
    const room = this.sfuRoomService.getRoom(roomId);
    if (!room) {
      throw new BadRequestException(`Room ${roomId} not found`);
    }

    const transport = await room.router.createWebRtcTransport({
      listenIps: mediasoupConfig.webRtcTransport.listenIps,
      enableUdp: mediasoupConfig.webRtcTransport.enableUdp,
      enableTcp: mediasoupConfig.webRtcTransport.enableTcp,
      preferUdp: mediasoupConfig.webRtcTransport.preferUdp,
      initialAvailableOutgoingBitrate:
        mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
    });

    if (mediasoupConfig.webRtcTransport.maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(
          mediasoupConfig.webRtcTransport.maxIncomingBitrate,
        );
      } catch (error) {
        this.logger.error('Error setting maxIncomingBitrate:', error);
      }
    }

    this.sfuRoomService.addTransport(roomId, userId, transport.id, transport);
    this.logger.log(
      `WebRTC ${direction} transport created for ${userId} in ${roomId}`,
    );

    return transport;
  }

  async connectTransport(
    roomId: string,
    userId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const transport = this.sfuRoomService.getTransport(
      roomId,
      userId,
      transportId,
    );
    if (!transport) {
      throw new BadRequestException(`Transport ${transportId} not found`);
    }

    await transport.connect({ dtlsParameters });
    this.logger.log(`Transport ${transportId} connected`);
  }

  async produce(
    roomId: string,
    userId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: RtpParameters,
    appData?: AppData,
  ): Promise<Producer> {
    const transport = this.sfuRoomService.getTransport(
      roomId,
      userId,
      transportId,
    );
    if (!transport) {
      throw new BadRequestException(`Transport ${transportId} not found`);
    }

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { ...appData, userId, kind } as AppData,
    });

    this.sfuRoomService.addProducer(roomId, userId, producer.id, producer);
    this.logger.log(`Producer ${producer.id} (${kind}) created for ${userId}`);

    producer.on('transportclose', () => {
      this.logger.log(`Producer ${producer.id} transport closed`);
    });

    return producer;
  }

  async consume(
    roomId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<Consumer> {
    const room = this.sfuRoomService.getRoom(roomId);
    if (!room) {
      throw new BadRequestException(`Room ${roomId} not found`);
    }

    const transport = this.sfuRoomService.getTransport(
      roomId,
      userId,
      transportId,
    );
    if (!transport) {
      throw new BadRequestException(`Transport ${transportId} not found`);
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new BadRequestException('Cannot consume this producer');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false,
    });

    this.sfuRoomService.addConsumer(roomId, userId, consumer.id, consumer);
    this.logger.log(
      `Consumer ${consumer.id} created for producer ${producerId}`,
    );

    consumer.on('transportclose', () => {
      this.logger.log(`Consumer ${consumer.id} transport closed`);
    });

    consumer.on('producerclose', () => {
      this.logger.log(`Consumer ${consumer.id} producer closed`);
    });

    return consumer;
  }

  async pauseProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    const producer = this.sfuRoomService.getProducer(
      roomId,
      userId,
      producerId,
    );
    if (!producer) {
      throw new BadRequestException(`Producer ${producerId} not found`);
    }
    await producer.pause();
  }

  async resumeProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Promise<void> {
    const producer = this.sfuRoomService.getProducer(
      roomId,
      userId,
      producerId,
    );
    if (!producer) {
      throw new BadRequestException(`Producer ${producerId} not found`);
    }
    await producer.resume();
  }

  closeProducer(roomId: string, userId: string, producerId: string): void {
    const producer = this.sfuRoomService.getProducer(
      roomId,
      userId,
      producerId,
    );
    if (!producer) {
      throw new BadRequestException(`Producer ${producerId} not found`);
    }
    producer.close();
  }
}
