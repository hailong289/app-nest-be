import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { types as MediasoupTypes } from 'mediasoup';
import { SfuService } from '../sfu.service';

type Router = MediasoupTypes.Router;
type Transport = MediasoupTypes.Transport;
type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;

export interface SFUParticipant {
  userId: string;
  transports: Map<string, Transport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface SFURoom {
  id: string;
  router: Router;
  participants: Map<string, SFUParticipant>;
  createdAt: Date;
}

@Injectable()
export class SfuRoomService {
  private readonly logger = new Logger(SfuRoomService.name);
  private rooms: Map<string, SFURoom> = new Map();

  constructor(private readonly sfuService: SfuService) {}

  async createRoom(roomId: string): Promise<SFURoom> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const router = await this.sfuService.createRouter(roomId);
    const room: SFURoom = {
      id: roomId,
      router,
      participants: new Map(),
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.logger.log(`SFU Room created: ${roomId}`);
    return room;
  }

  async joinRoom(roomId: string, userId: string): Promise<SFURoom> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = await this.createRoom(roomId);
    }

    if (!room.participants.has(userId)) {
      const participant: SFUParticipant = {
        userId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      room.participants.set(userId, participant);
      this.logger.log(`User ${userId} joined SFU room ${roomId}`);
    }

    return room;
  }

  leaveRoom(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(userId);
    if (participant) {
      participant.transports.forEach((transport) => transport.close());
      participant.producers.forEach((producer) => producer.close());
      participant.consumers.forEach((consumer) => consumer.close());
      room.participants.delete(userId);
      this.logger.log(`User ${userId} left SFU room ${roomId}`);
    }

    if (room.participants.size === 0) {
      room.router.close();
      this.rooms.delete(roomId);
      this.sfuService.deleteRouter(roomId);
      this.logger.log(`SFU Room ${roomId} closed (empty)`);
    }
  }

  getRoom(roomId: string): SFURoom | undefined {
    return this.rooms.get(roomId);
  }

  getParticipant(roomId: string, userId: string): SFUParticipant | undefined {
    return this.rooms.get(roomId)?.participants.get(userId);
  }

  addTransport(
    roomId: string,
    userId: string,
    transportId: string,
    transport: Transport,
  ): void {
    const participant = this.getParticipant(roomId, userId);
    if (!participant) {
      throw new NotFoundException(`Participant ${userId} not found`);
    }
    participant.transports.set(transportId, transport);
  }

  getTransport(
    roomId: string,
    userId: string,
    transportId: string,
  ): Transport | undefined {
    return this.getParticipant(roomId, userId)?.transports.get(transportId);
  }

  addProducer(
    roomId: string,
    userId: string,
    producerId: string,
    producer: Producer,
  ): void {
    const participant = this.getParticipant(roomId, userId);
    if (!participant) {
      throw new NotFoundException(`Participant ${userId} not found`);
    }
    participant.producers.set(producerId, producer);
  }

  getProducer(
    roomId: string,
    userId: string,
    producerId: string,
  ): Producer | undefined {
    return this.getParticipant(roomId, userId)?.producers.get(producerId);
  }

  addConsumer(
    roomId: string,
    userId: string,
    consumerId: string,
    consumer: Consumer,
  ): void {
    const participant = this.getParticipant(roomId, userId);
    if (!participant) {
      throw new NotFoundException(`Participant ${userId} not found`);
    }
    participant.consumers.set(consumerId, consumer);
  }

  getRoomsCount(): number {
    return this.rooms.size;
  }

  getTotalParticipantsCount(): number {
    let count = 0;
    this.rooms.forEach((room) => (count += room.participants.size));
    return count;
  }
}
