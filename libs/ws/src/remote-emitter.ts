import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { RedisService } from 'libs/db/src/redis/redis.service';

/**
 * Send Socket.IO events to clients connected to apps/socket from ANY other
 * NestJS service (chat, ai, learning, ...). Works because apps/socket uses
 * `@socket.io/redis-adapter` — every emit published via this emitter is
 * picked up by the adapter on the socket process and broadcast to clients.
 *
 * Usage in a microservice (chat, ai, ...):
 *   constructor(private readonly emitter: RemoteSocketEmitter) {}
 *
 *   await this.emitter.to(roomId).emit('message:upsert', payload);
 *   // or convenience:
 *   await this.emitter.broadcast(roomId, 'message:upsert', payload);
 *
 * No queue, no consumer. Apps/socket reacts in real time via Redis pub/sub.
 */
@Injectable()
export class RemoteSocketEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemoteSocketEmitter.name);
  private emitter!: Emitter;

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    // The emitter only issues Redis PUBLISH commands; it can safely share the
    // pooled ioredis client. No subscribe, no blocking calls.
    this.emitter = new Emitter(this.redis.client);
    this.logger.log('RemoteSocketEmitter ready');
  }

  onModuleDestroy() {
    // Nothing to close — the underlying redis client is owned by RedisService.
  }

  /**
   * Targets a room (Socket.IO room name) and returns a chained operator.
   * Equivalent to `io.to(room)` on the server.
   */
  to(room: string | string[]) {
    return this.emitter.to(room);
  }

  /**
   * Targets a namespace (default '/'). Same semantics as `io.of(nsp)`.
   */
  of(namespace: string) {
    return this.emitter.of(namespace);
  }

  /**
   * Convenience: emit to a single room in one call.
   */
  broadcast(room: string | string[], event: string, ...args: unknown[]): void {
    this.emitter.to(room).emit(event, ...args);
  }

  /**
   * Convenience: emit to a namespaced room.
   * Example: broadcastTo('/chat', roomId, 'message:upsert', msg)
   */
  broadcastTo(
    namespace: string,
    room: string | string[],
    event: string,
    ...args: unknown[]
  ): void {
    this.emitter.of(namespace).to(room).emit(event, ...args);
  }
}
