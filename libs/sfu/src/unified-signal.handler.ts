import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { SfuRpcClient } from './rpc/sfu-rpc.client';
// Type-only import — erased at compile time, so apps/socket bundle won't pull
// in the mediasoup native module. Only apps/sfu (on the VM) needs the runtime.
import type { types as MediasoupTypes } from 'mediasoup';
// Shared SocketWithUser type — same definition apps/socket uses, so
// `client.user?.usr_id` is properly typed as `string | undefined` instead
// of `any`. Lives in libs/types/ to avoid cross-app imports from libs.
// Note: import path is `libs/types` (relative-from-baseUrl), matching the
// project convention used by api-gateway controllers.
import type { SocketWithUser } from 'libs/types';

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
    | 'pauseConsumer'
    | 'resumeConsumer'
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
  consumerId?: string; // for pauseConsumer / resumeConsumer
  direction?: 'send' | 'recv';
  appData?: Record<string, unknown>; // echoed back in produce:me for callback matching
  userId?: string; // producer's userId, echoed back in consume response
}

/**
 * Unified Signal Handler
 * One event to rule them all - routes to P2P or SFU based on target.
 *
 * SFU operations are delegated to apps/sfu (mediasoup VM) via SfuRpcClient.
 * Socket emit/broadcast remains here on the signaling server.
 */
@Injectable()
export class UnifiedSignalHandler {
  private readonly logger = new Logger(UnifiedSignalHandler.name);

  constructor(private readonly sfuRpc: SfuRpcClient) {}

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
   * Handle SFU signals (server-side media processing via gRPC to apps/sfu)
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
    let roomId = rawRoomId;
    if (!(await this.sfuRpc.roomExists(rawRoomId))) {
      for (const socketRoom of client.rooms) {
        if (
          socketRoom !== client.id &&
          (await this.sfuRpc.roomExists(socketRoom))
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
          const { rtpCapabilities } = await this.sfuRpc.joinRoom(
            roomId,
            userId,
          );
          client.emit('signal', {
            type: 'join',
            sender: 'sfu',
            target: 'me',
            ok: true,
            rtpCapabilities,
          });
          break;
        }

        case 'createTransport': {
          if (!payload.direction) {
            throw new Error('Missing direction parameter');
          }

          const transport = await this.sfuRpc.createWebRtcTransport(
            roomId,
            userId,
            payload.direction,
          );

          client.emit('signal', {
            type: 'createTransport',
            sender: 'sfu',
            target: 'me',
            ok: true,
            transportId: transport.transportId,
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

          await this.sfuRpc.connectTransport(
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
            transportId: payload.transportId,
          });
          break;
        }

        case 'produce': {
          if (!payload.transportId || !payload.kind || !payload.rtpParameters) {
            throw new Error('Missing produce parameters');
          }

          const produceAppData = payload.appData ?? {};
          const { producerId } = await this.sfuRpc.produce(
            roomId,
            userId,
            payload.transportId,
            payload.kind,
            payload.rtpParameters,
            produceAppData,
          );

          // Notify others about new producer. Forward `appData` (e.g.
          // { source: "screen" }) so the receiving FE can pre-flag this
          // producer as screen BEFORE consume() runs — otherwise the
          // screen track would be routed to the camera Map.
          const broadcastAppData: Record<string, unknown> = produceAppData;
          client.to(roomId).emit('signal', {
            type: 'produce',
            sender: 'sfu',
            target: 'broadcast',
            ok: true,
            producerId,
            userId: userId,
            kind: payload.kind,
            appData: broadcastAppData,
          });

          client.emit('signal', {
            type: 'produce',
            sender: 'sfu',
            target: 'me',
            ok: true,
            producerId,
            appData: broadcastAppData, // echo back so FE callback can resolve
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

          const consumer = await this.sfuRpc.consume(
            roomId,
            userId,
            payload.transportId,
            payload.producerId,
            payload.rtpCapabilities,
          );

          // Find the userId who owns this producer so FE can map stream to user
          let producerUserId = payload.userId;
          if (!producerUserId) {
            producerUserId = await this.sfuRpc.findProducerOwner(
              roomId,
              payload.producerId,
            );
          }

          client.emit('signal', {
            type: 'consume',
            sender: 'sfu',
            target: 'me',
            ok: true,
            consumerId: consumer.consumerId,
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
          await this.sfuRpc.pauseProducer(roomId, userId, payload.producerId);
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
          await this.sfuRpc.resumeProducer(roomId, userId, payload.producerId);
          client.emit('signal', {
            type: 'resume',
            sender: 'sfu',
            target: 'me',
            ok: true,
          });
          break;
        }

        case 'pauseConsumer': {
          if (!payload.consumerId) {
            throw new Error('Missing consumerId');
          }
          await this.sfuRpc.pauseConsumer(roomId, userId, payload.consumerId);
          client.emit('signal', {
            type: 'pauseConsumer',
            sender: 'sfu',
            target: 'me',
            ok: true,
            consumerId: payload.consumerId,
          });
          break;
        }

        case 'resumeConsumer': {
          if (!payload.consumerId) {
            throw new Error('Missing consumerId');
          }
          await this.sfuRpc.resumeConsumer(roomId, userId, payload.consumerId);
          client.emit('signal', {
            type: 'resumeConsumer',
            sender: 'sfu',
            target: 'me',
            ok: true,
            consumerId: payload.consumerId,
          });
          break;
        }

        case 'leave': {
          await this.sfuRpc.leaveRoom(roomId, userId);
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
          const producers = await this.sfuRpc.getProducers(roomId, userId);
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
        ...(payload.transportId ? { transportId: payload.transportId } : {}),
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
