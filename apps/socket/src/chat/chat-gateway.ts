import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CallHistory, RedisService } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';
import type { ClientGrpc, ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent, socketEvent } from 'libs/dto/src/enum.type';
import Utils from 'libs/helpers/src/utils';
import { generateSnowflakeId } from 'libs/helpers/src/snowflake';
import { CHAT_KAFKA_PRODUCER } from './chat.tokens';
import { PresenceService } from '../ws/presence.service';
import type { JwtPayload, SocketWithUser } from '../ws/socket-user.types';

export interface ChatGrpcService {
  CreateNewMsg<T = any>(data: T): Observable<any>;
  getRoom<T = any>(data: T): Observable<any>;
  GetOneMsg<T = any>(data: T): Observable<any>;
  MarkReadUpTo<T = any>(data: T): Observable<any>;
  HandleReact<T = any>(data: T): Observable<any>;
  HandlePinned<T = any>(data: T): Observable<any>;
  HandleDeleteForUser<T = any>(data: T): Observable<any>;
  HandleDelete<T = any>(data: T): Observable<any>;
  RequestCall<T = any>(data: T): Observable<any>;
  AcceptCall<T = any>(data: T): Observable<any>;
  EndCall<T = any>(data: T): Observable<any>;
  SendCandidate<T = any>(data: T): Observable<any>;
  SyncUserRooms<T = any>(data: T): Observable<{ roomIds: string[] }>;
  KeepWarm<T = any>(data: T): Observable<{ ok: boolean }>;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/chat',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class ChatGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer() io!: Server;
  public get server(): Server {
    return this.io;
  }
  private readonly logger = new Logger(ChatGateway.name);
  private readonly key = REDISKEY;
  private ChatGrpcService!: ChatGrpcService;
  /** Timer keep-warm (Cloud Run cost optimization) — xem onModuleInit. */
  private keepWarmTimer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    @Inject(CHAT_KAFKA_PRODUCER)
    private readonly chatKafka: ClientKafka,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly presence: PresenceService,
  ) {}
  onModuleInit() {
    this.ChatGrpcService =
      this.chatClient.getService<ChatGrpcService>('ChatService');
    // Bind /chat namespace as the canonical STATUS broadcast channel.
    // Other namespaces (/call, /doc) call PresenceService too but emit
    // events through here so the FE only has to subscribe in one place.
    this.presence.setChatServer(this.io);
    // Kafka ingest là MẶC ĐỊNH (luôn chạy). Chỉ tắt (về gRPC) khi đặt rõ
    // CHAT_INGEST_MODE=grpc. emit() là fire-and-forget producer nên không cần
    // subscribe reply topic.
    if (process.env.CHAT_INGEST_MODE !== 'grpc') {
      this.chatKafka.connect().catch((err: unknown) =>
        this.logger.error(
          `[CHAT_INBOUND] Kafka producer connect failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

      // KEEP-WARM (Cloud Run cost optimization): chừng nào instance socket này
      // còn user /chat online → ping gRPC chat định kỳ để GIỮ chat instance sống
      // → consumer Kafka chat.inbound (chạy nền) không bị scale-to-0 làm chết.
      // Hết sạch user (mọi socket instance về 0) → không ai ping → chat tự idle
      // → scale 0 → ngủ (tiết kiệm). Chỉ chạy ở kafka mode.
      const everyMs = Number(process.env.CHAT_KEEPWARM_MS || 5 * 60 * 1000);
      this.keepWarmTimer = setInterval(() => {
        if (this.liveConns() > 0) this.keepWarm();
      }, everyMs);
      this.keepWarmTimer.unref?.();
    }
  }

  async onModuleDestroy() {
    if (this.keepWarmTimer) clearInterval(this.keepWarmTimer);
  }

  /** Số connection /chat còn sống TRÊN INSTANCE NÀY (local, không tính remote). */
  private liveConns(): number {
    try {
      const io = this.io as unknown as {
        sockets?: Map<string, unknown> | { sockets?: Map<string, unknown> };
        of?: (ns: string) => { sockets: Map<string, unknown> };
      };
      if (io.sockets instanceof Map) return io.sockets.size;
      if (typeof io.of === 'function') return io.of('/chat').sockets.size;
      const inner = (io.sockets as { sockets?: Map<string, unknown> })?.sockets;
      return inner instanceof Map ? inner.size : 0;
    } catch {
      return 0;
    }
  }

  /** Ping gRPC KeepWarm (fire-and-forget) — giữ chat instance sống cho consumer. */
  private keepWarm(): void {
    if (!this.ChatGrpcService) return;
    void Utils.dispatchGrpcRequest(
      this.ChatGrpcService.KeepWarm.bind(this.ChatGrpcService),
      {},
    ).catch(() => undefined);
  }

  // ========================================================
  // 🟢 HÀM XỬ LÝ KẾT NỐI (HANDLING CONNECTION)
  // ========================================================
  async handleConnection(client: SocketWithUser) {
    // Xác thực JWT trong handleConnection
    try {
      // Lấy token từ nhiều nguồn
      let token: string | undefined =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization as string);

      if (!token) {
        this.logger.warn(
          `[CONNECT] No token provided from client ${client.id}`,
        );
        client.emit('exception', {
          status: 'error',
          message: 'Xác thực không thành công - Token không được cung cấp',
        });
        client.disconnect();
        return;
      }

      // Loại bỏ "Bearer " prefix
      if (token.startsWith('Bearer ')) {
        token = token.replace('Bearer ', '');
      }

      const jwtSecret = this.configService.get<string>(
        'GATEWAY_JWT_ACCESS_SECRET',
      );

      if (!jwtSecret) {
        this.logger.error('[CONNECT] JWT secret not configured');
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: jwtSecret,
      });

      // Redis blacklist check (presence = revoked).
      if (payload.jti && payload._id) {
        const isRevoked = await this.redis.getData<string>(
          this.key.REFRESH_TOKEN(payload._id, payload.jti),
        );

        if (isRevoked) {
          this.logger.warn(
            `[CONNECT] Token revoked or expired for user ${payload._id}`,
          );
          client.emit('exception', {
            status: 'error',
            message: 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi',
          });
          client.disconnect();
          return;
        }
      }

      client.userId = payload._id;
      client.user = payload;

      // SONG SONG HOÁ 3 IO độc lập của handshake: join system room + presence
      // register + đọc USER_ROOMS. Trước đây 3 `await` tuần tự, mỗi cái 1
      // round-trip Redis WAN → khi ~1000 connect đồng loạt, handshake đình trệ
      // vượt pingTimeout → server đá client → reconnect storm. Gộp Promise.all →
      // còn ~1 round-trip-time. (PresenceService chỉ broadcast STATUS ở 0→1.)
      const [, , roomIdsInit] = await Promise.all([
        client.join([this.key.ROOM_CLIENT(payload.usr_id), 'system']),
        this.presence.register('chat', client.id, payload.usr_id),
        this.redis.sMembers(this.key.USER_ROOMS(client.userId)),
      ]);
      let roomIds = roomIdsInit;

      // Wake chat NGAY khi user vừa online (mặc định kafka) → consumer Kafka sẵn
      // sàng trước khi user kịp gửi tin đầu (giảm cold-start cho tin đầu tiên).
      if (process.env.CHAT_INGEST_MODE !== 'grpc') this.keepWarm();

      this.logger.log(
        `[CONNECT] User ${payload.usr_fullname} (${payload._id}) connected.`,
      );
      // Cache lạnh (Redis vừa flush / lần đầu) → nhờ chat service rebuild từ
      // Mongo (lazy-sync) rồi trả lại danh sách phòng để auto-join.
      if (!roomIds.length) {
        const res = (await Utils.dispatchGrpcRequest(
          this.ChatGrpcService.SyncUserRooms.bind(this.ChatGrpcService),
          { userId: client.userId },
        )) as { roomIds?: string[] };
        roomIds = res?.roomIds ?? [];
      }
      // Join theo lô để không block event loop khi user ở rất nhiều phòng.
      const JOIN_CHUNK = 500;
      for (let i = 0; i < roomIds.length; i += JOIN_CHUNK) {
        await client.join(roomIds.slice(i, i + JOIN_CHUNK));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit(socketEvent.EXCEPTION, {
        status: 'error',
        statusCode: 401,
        message: 'Mã xác thực không hợp lệ hoặc đã hết hạn',
      });
      client.disconnect();
    }
  }

  // ========================================================
  // 🔴 HÀM XỬ LÝ NGẮT KẾT NỐI (HANDLING DISCONNECT)
  // ========================================================
  async handleDisconnect(client: SocketWithUser) {
    const userId = client.userId;
    const usrId = client.user?.usr_id;
    const fullname = client.user?.usr_fullname;

    if (!userId || !usrId) return;
    this.logger.log(`[DISCONNECT] User ${fullname} (${userId}) disconnected.`);

    // Delegate presence cleanup to the service — it pulls this socket out
    // of the per-user set, deletes the alive key, and only broadcasts
    // offline if NO other socket (other tab, /call, /doc) is left.
    const { wentOffline } = await this.presence.unregister(
      'chat',
      client.id,
      usrId,
    );
    if (wentOffline) {
      this.io.emit('system', `${fullname} went offline.`);
    }
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: SocketWithUser) {
    if (!client.user?.usr_id) return;
    // Just refresh per-socket alive TTL. The cron uses this to detect
    // dead sockets; the user-level online set is left untouched (the
    // socket id is still a member as long as the connection exists).
    await this.presence.heartbeat('chat', client.id, client.user.usr_id);
  }

  // ========================================================
  // 💬 CÁC SUBSCRIBE MESSAGE (Giữ nguyên)
  // ========================================================
  @SubscribeMessage(socketEvent.JOINROOM)
  async join(
    @MessageBody() { roomId }: { roomId: string },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return { ok: false, message: 'Unauthorized' };
    }

    await client.join(roomId);
    this.logger.log(`${user.usr_fullname} joined room ${roomId}`); // Broadcast đến mọi người trong room

    this.io.to(roomId).emit(socketEvent.USERJOIN, {
      name: user.usr_fullname,
      roomId,
      joinDated: new Date(),
    });
    return { ok: true, user };
  }

  @SubscribeMessage(socketEvent.MSGSEND)
  async onMessage(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      type: string;
      content: string;
      attachments?: Array<string>;
      replyTo: string;
      id?: string;
      quizId?: string;
      desk_id?: string;
      todoProjectId?: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;
    try {
      // ── Phase 1: Kafka ingest path (CHAT_INGEST_MODE=kafka) ────────────
      // Produce thẳng vào topic `chat.inbound` với key=roomId (ordering theo
      // phòng) rồi ACK người gửi NGAY (optimistic). Chat service consume +
      // micro-batch bulkWrite. msgId = client `id` nếu có (idempotency), nếu
      // không thì sinh snowflake k-sortable. MẶC ĐỊNH = kafka; đặt
      // CHAT_INGEST_MODE=grpc để quay lại gRPC sync (fallback).
      if (process.env.CHAT_INGEST_MODE !== 'grpc') {
        const msgId = data.id ?? generateSnowflakeId();
        const payload = { ...data, userId: user._id, msgId, id: msgId };
        // emit({ key, value }) → ClientKafka set partition key = roomId.
        this.chatKafka.emit(KafkaEvent.CHAT_INBOUND, {
          key: data.roomId,
          value: payload,
        });
        return { ok: true, data: { msgId } };
      }

      // Tạo message qua gRPC. Việc phát 'message:upsert' tới các thành viên
      // KHÔNG còn diễn ra ở đây nữa — chat service đã bắn thẳng qua Redis
      // adapter ngay sau khi dựng xong payload (giảm độ trễ, bỏ vòng gRPC về
      // gateway). Gateway chỉ trả ack cho người gửi.
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.CreateNewMsg.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MESSAGE] Error creating message:', error);
      client.emit(socketEvent.ERRORMSG, {
        message: 'Gửi tin nhắn thất bại',
        error: error instanceof Error ? error.message : String(error),
        data,
      });

      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage(socketEvent.MSGMARKREAD)
  async MarkRead(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      lastMessageId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Đánh dấu đã đọc qua gRPC
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.MarkReadUpTo.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;
      // markReadUpTo có thể trả early-return (không phải member) / throw (phòng-tin
      // không tồn tại, service lỗi) → `metadata` null/thiếu `members`. Guard để
      // KHÔNG crash khi đọc `.msg`/`.members` (đây chính là lỗi
      // "Cannot read properties of null (reading 'msg')").
      const meta = result?.metadata as
        | { msg?: unknown; members?: Array<Record<string, any>> }
        | null
        | undefined;
      if (!meta || !Array.isArray(meta.members)) {
        this.logger.warn(
          '[MARK_READ] kết quả rỗng/không hợp lệ, bỏ qua broadcast',
        );
        return { ok: false };
      }
      const memberIds = meta.members.map((member: Record<string, any>) =>
        this.key.ROOM_CLIENT(member.id),
      );
      this.io.to(memberIds).emit(socketEvent.MSGUPSERT, meta.msg);
      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MARK_READ] Error marking message as read:', error);
      client.emit('error', {
        message: 'Đánh dấu đã đọc thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  @SubscribeMessage(socketEvent.MSGREACT)
  async SendEmoji(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      msgId: string;
      emoji: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }
    data.userId = user._id;
    try {
      // Tạo message qua gRPC
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.HandleReact.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;
      const msg = result.metadata.msg;
      const memberIds = result.metadata.members.map(
        (member: Record<string, any>) => this.key.ROOM_CLIENT(member.id),
      );
      this.io.to(memberIds).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MESSAGE] Error creating message:', error);
      client.emit('error', {
        message: 'Gửi tin nhắn thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  @SubscribeMessage(socketEvent.MSGPINNED)
  async MessagePinned(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      msgId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Tạo message qua gRPC
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.HandlePinned.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;
      const msg = result.metadata.msg;
      const memberIds = result.metadata.members.map(
        (member: Record<string, any>) => this.key.ROOM_CLIENT(member.id),
      );
      this.io.to(memberIds).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MESSAGE] Error creating message:', error);
      client.emit('error', {
        message: 'Gửi tin nhắn thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  @SubscribeMessage(socketEvent.MSGDELETE)
  async MessageDelete(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      msgId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Tạo message qua gRPC
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.HandleDeleteForUser.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayDeleteResponse;

      const metadata = result?.metadata ?? {};
      const memberIds = metadata.members.map((member: Record<string, any>) =>
        this.key.ROOM_CLIENT(member.id),
      );
      const msgs: Array<Record<string, any>> = Array.isArray(metadata.msgs)
        ? metadata.msgs
        : [];
      msgs.forEach((m) => {
        this.io.to(memberIds).emit(socketEvent.MSGUPSERT, m);
      });

      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MESSAGE] Error deleting message for users:', error);
      client.emit('error', {
        message: 'Xóa tin nhắn thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  @SubscribeMessage(socketEvent.MSGRECALL)
  async MessageReCall(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      msgId: string;
      placeholder: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Gọi đúng hàm HandleDelete (recall) thay vì HandleDeleteForUser
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.HandleDelete.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayDeleteResponse;

      const metadata = result?.metadata ?? {};
      const memberIds = metadata.members.map((member: Record<string, any>) =>
        this.key.ROOM_CLIENT(member.id),
      );
      const msgs: Array<Record<string, any>> = Array.isArray(metadata.msgs)
        ? metadata.msgs
        : [];
      msgs.forEach((m) => {
        this.io.to(memberIds).emit(socketEvent.MSGUPSERT, m);
      });
      return { ok: true, data: result };
    } catch (error) {
      this.logger.error('[MESSAGE] Error recalling message:', error);
      client.emit('error', {
        message: 'Thu hồi tin nhắn thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getUser(@ConnectedSocket() client: SocketWithUser) {
    if (!client.user) {
      try {
        let token: string | undefined =
          (client.handshake.auth?.token as string) ||
          (client.handshake.query?.token as string) ||
          (client.handshake.headers?.authorization as string);

        if (token) {
          if (token.startsWith('Bearer ')) {
            token = token.replace('Bearer ', '');
          }
          const jwtSecret = this.configService.get<string>(
            'GATEWAY_JWT_ACCESS_SECRET',
          );
          if (jwtSecret) {
            const payload = this.jwtService.verify<JwtPayload>(token, {
              secret: jwtSecret,
            });
            if (payload.jti && payload._id) {
              // Blacklist check — presence = revoked. Only attach user
              // context if the JTI is NOT in the Redis blacklist.
              const isRevoked = await this.redis.getData<string>(
                this.key.REFRESH_TOKEN(payload._id, payload.jti),
              );

              if (!isRevoked) {
                client.user = payload;
                client.userId = payload._id;
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `[getUser] Re-auth failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const user = client.user;
    if (!user) {
      throw new Error('Unauthorized');
    }
    return user;
  }

  @SubscribeMessage(socketEvent.USERSATUS)
  async CheckUserOnline(
    @MessageBody()
    data: { ids?: unknown },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    // Accept both shapes for backwards compat: bare array or { ids: [...] }.
    let rawIds: unknown[] = [];
    if (Array.isArray(data)) {
      rawIds = data;
    } else if (
      data &&
      typeof data === 'object' &&
      'ids' in data &&
      Array.isArray((data as Record<string, any>).ids)
    ) {
      rawIds = (data as Record<string, any>).ids as unknown[];
    }

    const ids: string[] = rawIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (ids.length === 0) return;

    // Note: presence is keyed by Mongo `_id` (the userId we store in Redis)
    // but the FE knows users by `usr_id` (ULID). The FE sends usr_id values
    // here, so the service receives usr_id strings and queries the SAME
    // user-online set. To make this work we treat the FE-provided id as the
    // userId for presence — and the broadcast emits with `id: usr_id`. To
    // keep this consistent we look up presence directly by the id received
    // (works as long as we registered with the same id in handleConnection).
    //
    // Reality: handleConnection registers with `payload._id` (Mongo). FE
    // queries by `usr_id`. So the existing implementation already had this
    // mismatch — it returned `isOnline: false` for everyone. Fix by adding
    // a hybrid: try both keys, return online if either is non-empty.
    const result = await Promise.all(
      ids.map(async (id) => {
        const a = await this.presence.isOnline(id);
        return { id, isOnline: a };
      }),
    );

    // Emit ONLY to the requesting socket (not broadcast). Bulk responses
    // are personal — other clients shouldn't receive someone else's query.
    client.emit('status:online:bulk', { users: result });
  }

  @SubscribeMessage(socketEvent.USERTYPING)
  async onTypingIndicator(
    @MessageBody()
    data: {
      roomId: string;
      typing: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let userPayload: JwtPayload;
    try {
      userPayload = await this.getUser(client);
    } catch {
      return;
    }

    const user = {
      id: userPayload.usr_id,
      name: userPayload.usr_fullname,
      avatar: userPayload.usr_avatar,
    };

    this.io.to(data.roomId).emit(socketEvent.STATUSTYPING, {
      user,
      typing: data.typing,
      roomId: data.roomId,
    });
  }

  // @SubscribeMessage(socketEvent.QUIZZANSWER)
  // async handleQuizzAnswer(
  //   @MessageBody()
  //   data: {
  //     quizId: string;
  //     answer: {};
  //   },
  //   @ConnectedSocket() client: SocketWithUser,
  // ) {
  //   try {
  //     const user = await this.getUser(client);
  //   } catch (error) {
  //     this.logger.error('[QUIZZ] Error answering quizz:', error);
  //     return {
  //       ok: false,
  //       error: error instanceof Error ? error.message : String(error),
  //     };
  //   }
  // }

  @SubscribeMessage(socketEvent.UPDATE_QUIZ)
  async handleUpdateQuiz(
    @MessageBody()
    data: {
      roomId: string;
      quizId: string;
      payload: Record<string, any>;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }
    const { roomId, quizId, payload } = data;
    if (!roomId || !quizId) {
      client.emit('error', {
        message: 'roomId và quizId là bắt buộc',
      });
      return { ok: false };
    }
    this.io
      .to(roomId)
      .except(client.id)
      .emit(socketEvent.UPDATE_QUIZ, { roomId, quizId, payload });
    return { ok: true };
  }

  @SubscribeMessage(socketEvent.UPDATE_TODO)
  async handleUpdateTodo(
    @MessageBody()
    data: {
      projectId: string;
      todoId: string;
      payload: Record<string, any>;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    const { projectId, todoId, payload } = data;
    if (!projectId || !todoId) {
      client.emit('error', {
        message: 'projectId và todoId là bắt buộc',
      });
      return { ok: false };
    }

    this.io
      .to(projectId)
      .except(client.id)
      .emit(socketEvent.UPDATE_TODO, { projectId, todoId, payload });
    return { ok: true };
  }
}

interface ChatGatewayResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    msgId: string;
    members: Array<Record<string, any>>;
    roomId: string;
    msg: Record<string, any>;
    call_history?: CallHistory;
    // Có thể bổ sung các trường khác nếu cần
  };
}

interface ChatGatewayDeleteResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    msgs: Array<Record<string, any>>;
    members: Array<Record<string, any>>;
    roomId: string;
    // Có thể bổ sung các trường khác nếu cần
  };
}
