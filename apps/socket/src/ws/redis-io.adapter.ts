/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

interface QueuedEmit {
  room: string;
  event: string;
  data: any;
  timestamp: number;
  retries: number;
}

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private isRedisConnected = true;
  private emitQueue: QueuedEmit[] = [];
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MAX_RETRIES = 3;
  private readonly QUEUE_TTL_MS = 5 * 60 * 1000;
  private server: Server | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
  ) {
    super(app);
    this.setupRedisEventHandlers();
  }

  private setupRedisEventHandlers(): void {
    this.pubClient.on('error', (err) => {
      this.logger.error(`Redis pub client error: ${err?.message ?? err}`);
      this.isRedisConnected = false;
    });

    this.pubClient.on('close', () => {
      this.logger.warn('Redis pub client disconnected');
      this.isRedisConnected = false;
    });

    this.pubClient.on('reconnecting', () => {
      this.logger.log('Redis pub client reconnecting...');
    });

    this.pubClient.on('ready', () => {
      this.logger.log('Redis pub client ready');
      this.isRedisConnected = true;
      this.flushQueuedEmits();
    });

    this.subClient.on('error', (err) => {
      this.logger.error(`Redis sub client error: ${err?.message ?? err}`);
    });

    this.subClient.on('close', () => {
      this.logger.warn('Redis sub client disconnected');
    });

    this.subClient.on('reconnecting', () => {
      this.logger.log('Redis sub client reconnecting...');
    });

    this.subClient.on('ready', () => {
      this.logger.log('Redis sub client ready');
    });
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      cors: { origin: '*', credentials: true },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      // Nới slack ping cho TẢI CAO: khi nhiều connect đồng loạt, event loop /
      // handshake bận → nếu pong trễ quá pingTimeout, server ĐÁ client → reconnect
      // storm. Tăng pingTimeout giúp client trụ qua lúc server bận.
      pingInterval: 25000,
      pingTimeout: 45000,
      // RESUME session khi reconnect (mất mạng ngắn / scale / server bận): khôi
      // phục rooms + packet lỡ, KHÔNG chạy lại full handshake nặng → CHẶN reconnect
      // storm (gốc của "rớt lên rớt xuống" ở tải cao).
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
      },
      ...options,
    }) as Server;

    this.server = server;

    const adapter = createAdapter(this.pubClient, this.subClient);
    server.adapter(adapter);

    this.wrapServerEmitMethods(server);

    return server;
  }

  private wrapServerEmitMethods(server: Server): void {
    const originalTo = (server.to as any).bind(server);
    const originalIn = (server.in as any).bind(server);

    server.to = (room: string | string[]): any => {
      const namespace = originalTo(room);
      return this.wrapBroadcastOperator(namespace, room);
    };

    server.in = (room: string | string[]): any => {
      const namespace = originalIn(room);
      return this.wrapBroadcastOperator(namespace, room);
    };
  }

  private wrapBroadcastOperator(operator: any, room: string | string[]): any {
    const originalEmit = operator.emit.bind(operator);
    const roomStr = Array.isArray(room) ? room[0] : room;

    operator.emit = (event: string, ...args: any[]) => {
      if (!this.isRedisConnected) {
        this.logger.warn(
          `Redis disconnected. Queuing emit: room=${roomStr}, event=${event}`,
        );
        this.queueEmit(roomStr, event, args[0]);
        return operator;
      }

      try {
        return originalEmit(event, ...args);
      } catch (error) {
        this.logger.error(
          `Failed to emit event: ${event}`,
          (error as Error).stack,
        );
        this.queueEmit(roomStr, event, args[0]);
        return operator;
      }
    };

    return operator;
  }

  private queueEmit(room: string, event: string, data: any): void {
    if (this.emitQueue.length >= this.MAX_QUEUE_SIZE) {
      this.logger.warn(
        `Emit queue is full (${this.MAX_QUEUE_SIZE}). Removing oldest items.`,
      );
      this.emitQueue.splice(0, Math.floor(this.MAX_QUEUE_SIZE * 0.2));
    }

    this.emitQueue.push({
      room,
      event,
      data,
      timestamp: Date.now(),
      retries: 0,
    });

    this.logger.debug(
      `Queued emit: room=${room}, event=${event}, queue_size=${this.emitQueue.length}`,
    );
  }

  private flushQueuedEmits(): void {
    if (this.emitQueue.length === 0 || !this.server) {
      return;
    }

    this.logger.log(
      `Flushing ${this.emitQueue.length} queued emits after Redis reconnect`,
    );

    const now = Date.now();
    const validEmits: QueuedEmit[] = [];
    const expiredEmits: QueuedEmit[] = [];

    for (const queuedEmit of this.emitQueue) {
      if (now - queuedEmit.timestamp > this.QUEUE_TTL_MS) {
        expiredEmits.push(queuedEmit);
      } else {
        validEmits.push(queuedEmit);
      }
    }

    if (expiredEmits.length > 0) {
      this.logger.warn(
        `Discarding ${expiredEmits.length} expired emits (TTL: ${this.QUEUE_TTL_MS}ms)`,
      );
    }

    const failedEmits: QueuedEmit[] = [];

    for (const queuedEmit of validEmits) {
      try {
        this.logger.debug(
          `Replaying emit: room=${queuedEmit.room}, event=${queuedEmit.event}`,
        );

        this.server.to(queuedEmit.room).emit(queuedEmit.event, queuedEmit.data);
      } catch (error) {
        this.logger.error(
          `Failed to replay emit: room=${queuedEmit.room}, event=${queuedEmit.event}`,
          (error as Error).stack,
        );

        queuedEmit.retries++;
        if (queuedEmit.retries < this.MAX_RETRIES) {
          failedEmits.push(queuedEmit);
        } else {
          this.logger.error(
            `Max retries reached for emit: room=${queuedEmit.room}, event=${queuedEmit.event}`,
          );
        }
      }
    }

    this.emitQueue = failedEmits;

    this.logger.log(
      `Flushed queued emits. Success: ${validEmits.length - failedEmits.length}, Failed: ${failedEmits.length}, Expired: ${expiredEmits.length}`,
    );
  }

  async close(server?: Server): Promise<void> {
    this.logger.log('Closing Redis adapter...');
    this.emitQueue = [];
    this.server = null;
    await super.close(server!);
  }
}
