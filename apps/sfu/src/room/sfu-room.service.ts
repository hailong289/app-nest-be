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

    // Always create a fresh participant entry. If the user is re-joining (e.g. they
    // ended the call and clicked "Tham gia" again), their old transports/producers are
    // already closed on the client side but the server-side objects may linger until
    // the DTLS/ICE disconnect timeout fires. Cleaning them up eagerly ensures
    // getProducers returns only live producers and createTransport has a clean slate.
    const existing = room.participants.get(userId);
    if (existing) {
      existing.transports.forEach((t) => {
        if (!t.closed) t.close();
      });
      existing.producers.forEach((p) => {
        if (!p.closed) p.close();
      });
      existing.consumers.forEach((c) => {
        if (!c.closed) c.close();
      });
      room.participants.delete(userId);
      this.logger.log(
        `User ${userId} re-joining SFU room ${roomId}, old state cleaned up`,
      );
    }

    const participant: SFUParticipant = {
      userId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.participants.set(userId, participant);
    this.logger.log(`User ${userId} joined SFU room ${roomId}`);

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
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    let participant = room.participants.get(userId);
    if (!participant) {
      // Auto-register: participant may have missed the joinRoom step due to timing
      this.logger.warn(
        `[SFU] Auto-registering participant ${userId} in room ${roomId}`,
      );
      participant = {
        userId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      room.participants.set(userId, participant);
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

  getConsumer(
    roomId: string,
    userId: string,
    consumerId: string,
  ): Consumer | undefined {
    return this.getParticipant(roomId, userId)?.consumers.get(consumerId);
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
