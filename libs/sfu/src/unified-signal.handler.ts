import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SfuRoomService } from './room/sfu-room.service';
import { SfuTransportService } from './transport/sfu-transport.service';
import * as MediasoupTypes from 'mediasoup/types';

/**
 * Socket with user info (after auth)
 */
interface SocketWithUser extends Socket {
  userId?: string; // MongoDB _id (ObjectId)
  user?: any; // JWT payload — has usr_id (ULID) used for member IDs on FE
}

/**
 * Unified Signal Payload Interface
 */
interface SignalPayload {
  roomId: string;
  type:
    | 'offer'
    | 'answer'
    | 'candidate'
    | 'join'
    | 'createTransport'
    | 'connectTransport'
    | 'produce'
    | 'consume'
    | 'pause'
    | 'resume'
    | 'leave'
    | 'getProducers';
  target: 'sfu' | (string & {}); // 'sfu' for server, userId for P2P

  // P2P data
  sdp?: unknown;
  candidate?: unknown;

  // SFU data
  transportId?: string;
  kind?: MediasoupTypes.MediaKind;
  rtpParameters?: MediasoupTypes.RtpParameters;
  rtpCapabilities?: MediasoupTypes.RtpCapabilities;
  dtlsParameters?: MediasoupTypes.DtlsParameters;
  producerId?: string;
  direction?: 'send' | 'recv';
  appData?: Record<string, unknown>; // echoed back in produce:me for callback matching
  userId?: string; // producer's userId, echoed back in consume response
}

/**
 * Unified Signal Handler
 * One event to rule them all - routes to P2P or SFU based on target
 */
@Injectable()
export class UnifiedSignalHandler {
  private readonly logger = new Logger(UnifiedSignalHandler.name);

  constructor(
    private readonly sfuRoomService: SfuRoomService,
    private readonly sfuTransportService: SfuTransportService,
  ) {}

  /**
   * Main signal handler - routes based on target field
   * Called by CallGateway's @SubscribeMessage('signal') handler
   */
  async handleSignal(
    payload: SignalPayload,
    client: SocketWithUser,
    server: Server,
  ) {
    const { target, roomId, type } = payload;

    this.logger.log(
      `[SIGNAL] Type: ${type}, Target: ${target}, Room: ${roomId}`,
    );

    // ROUTE A: SFU Server Processing
    if (target === 'sfu') {
      return await this.handleSFUSignal(payload, client);
    }

    // ROUTE B: P2P Forward to specific user
    else {
      return this.handleP2PSignal(payload, client, server);
    }
  }

  /**
   * Handle SFU signals (server-side media processing)
   */
  private async handleSFUSignal(
    payload: SignalPayload,
    client: SocketWithUser,
  ) {
    const { type, roomId: rawRoomId } = payload;
    // Use usr_id (ULID) so it matches the member.id used on the FE side.
    // client.userId holds the MongoDB ObjectId (_id); client.user?.usr_id is the custom ULID.
    const userId = client.user?.usr_id || client.userId || 'unknown';

    // Normalize roomId: the FE join URL uses msg.roomId (MongoDB ObjectId), while the socket
    // room and SFU room are keyed by room.room_id (custom string). If the provided roomId has
    // no SFU room yet, find a socket room the client already joined that DOES have an SFU room.
    // This is reliable because call:join always does client.join(room.room_id) before signal:join.
    let roomId = rawRoomId;
    if (!this.sfuRoomService.getRoom(rawRoomId)) {
      for (const socketRoom of client.rooms) {
        if (
          socketRoom !== client.id &&
          this.sfuRoomService.getRoom(socketRoom)
        ) {
          this.logger.log(
            `[SFU] Normalized roomId: ${rawRoomId} → ${socketRoom} (ObjectId→room_id)`,
          );
          roomId = socketRoom;
          break;
        }
      }
    }

    try {
      switch (type) {
        case 'join': {
          const room = await this.sfuRoomService.joinRoom(roomId, userId);
          client.emit('signal', {
            type: 'join',
            sender: 'sfu',
            target: 'me',
            ok: true,
            rtpCapabilities: room.router.rtpCapabilities,
          });
          break;
        }

        case 'createTransport': {
          if (!payload.direction) {
            throw new Error('Missing direction parameter');
          }

          const transport =
            await this.sfuTransportService.createWebRtcTransport(
              roomId,
              userId,
              payload.direction,
            );

          client.emit('signal', {
            type: 'createTransport',
            sender: 'sfu',
            target: 'me',
            ok: true,
            transportId: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
          break;
        }

        case 'connectTransport': {
          if (!payload.transportId || !payload.dtlsParameters) {
            throw new Error('Missing transport parameters');
          }

          await this.sfuTransportService.connectTransport(
            roomId,
            userId,
            payload.transportId,
            payload.dtlsParameters,
          );

          client.emit('signal', {
            type: 'connectTransport',
            sender: 'sfu',
            target: 'me',
            ok: true,
          });
          break;
        }

        case 'produce': {
          if (!payload.transportId || !payload.kind || !payload.rtpParameters) {
            throw new Error('Missing produce parameters');
          }

          const producer = await this.sfuTransportService.produce(
            roomId,
            userId,
            payload.transportId,
            payload.kind,
            payload.rtpParameters,
          );

          // Notify others about new producer
          client.to(roomId).emit('signal', {
            type: 'produce',
            sender: 'sfu',
            target: 'broadcast',
            ok: true,
            producerId: producer.id,
            userId: userId,
            kind: payload.kind,
          });

          client.emit('signal', {
            type: 'produce',
            sender: 'sfu',
            target: 'me',
            ok: true,
            producerId: producer.id,
            appData: payload.appData || {}, // echo back so FE callback can resolve
          });
          break;
        }

        case 'consume': {
          if (
            !payload.transportId ||
            !payload.producerId ||
            !payload.rtpCapabilities
          ) {
            throw new Error('Missing consume parameters');
          }

          const consumer = await this.sfuTransportService.consume(
            roomId,
            userId,
            payload.transportId,
            payload.producerId,
            payload.rtpCapabilities,
          );

          // Find the userId who owns this producer so FE can map stream to user
          let producerUserId = payload.userId;
          if (!producerUserId) {
            const room = this.sfuRoomService.getRoom(roomId);
            if (room) {
              room.participants.forEach((participant, pUserId) => {
                if (participant.producers.has(payload.producerId!)) {
                  producerUserId = pUserId;
                }
              });
            }
          }

          client.emit('signal', {
            type: 'consume',
            sender: 'sfu',
            target: 'me',
            ok: true,
            consumerId: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            userId: producerUserId, // so FE can key the stream by userId
          });
          break;
        }

        case 'pause': {
          if (!payload.producerId) {
            throw new Error('Missing producerId');
          }
          await this.sfuTransportService.pauseProducer(
            roomId,
            userId,
            payload.producerId,
          );
          client.emit('signal', {
            type: 'pause',
            sender: 'sfu',
            target: 'me',
            ok: true,
          });
          break;
        }

        case 'resume': {
          if (!payload.producerId) {
            throw new Error('Missing producerId');
          }
          await this.sfuTransportService.resumeProducer(
            roomId,
            userId,
            payload.producerId,
          );
          client.emit('signal', {
            type: 'resume',
            sender: 'sfu',
            target: 'me',
            ok: true,
          });
          break;
        }

        case 'leave': {
          this.sfuRoomService.leaveRoom(roomId, userId);
          client.emit('signal', {
            type: 'leave',
            sender: 'sfu',
            target: 'me',
            ok: true,
          });
          break;
        }

        case 'getProducers': {
          // Return all active producers in the room except the requesting user's own
          const room = this.sfuRoomService.getRoom(roomId);
          const producers: Array<{
            producerId: string;
            userId: string;
            kind: string;
          }> = [];
          if (room) {
            room.participants.forEach((participant, pUserId) => {
              if (pUserId !== userId) {
                participant.producers.forEach((producer) => {
                  if (!producer.closed) {
                    producers.push({
                      producerId: producer.id,
                      userId: pUserId,
                      kind: producer.kind,
                    });
                  }
                });
              }
            });
          }
          client.emit('signal', {
            type: 'getProducers',
            sender: 'sfu',
            target: 'me',
            ok: true,
            producers,
          });
          break;
        }

        default:
          this.logger.warn(`Unknown SFU signal type: ${type}`);
      }
    } catch (error: unknown) {
      this.logger.error(`[SFU] Error handling signal:`, error);
      client.emit('signal', {
        type,
        sender: 'sfu',
        target: 'me',
        ok: false,
        message:
          error instanceof Error ? error.message : 'SFU operation failed',
      });
    }
  }

  /**
   * Handle P2P signals (forward to target user)
   */
  private handleP2PSignal(
    payload: SignalPayload,
    client: SocketWithUser,
    server: Server,
  ) {
    const { target, type, sdp, candidate, roomId } = payload;

    this.logger.log(
      `[P2P] Forwarding ${type} from ${client.userId} to ${target}`,
    );

    // Forward signal to target user
    server.to(target).emit('signal', {
      type,
      sdp,
      candidate,
      sender: client.userId,
      target: 'me',
      roomId,
    });

    return { ok: true };
  }
}
