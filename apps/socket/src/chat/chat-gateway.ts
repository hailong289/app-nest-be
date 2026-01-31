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
  BadRequestException,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CallHistory, CallStatus, RedisService, Room } from 'libs/db/src';
import { REDISKEY, REDIS_TTL } from '@app/constants/RedisKey';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { socketEvent } from 'libs/dto/src/enum.type';
import Utils from 'libs/helpers/src/utils';

interface JwtPayload {
  _id: string; // MongoDB _id: "68ff5ede5903ab252a84b117"
  usr_fullname: string; // "Lê Thiên Trí"
  usr_email: string; // "thientrile2003@gmail.com"
  usr_phone?: string;
  usr_avatar?: string; // "https://avatar.iran.liara.run/public/username?username=lêthiêntrí"
  usr_gender?: string; // "male"
  usr_status?: string; // "active"
  usr_id: string; // "019a258a9540000000ff11"
  usr_slug: string; // "usr_019a258a9540000001b0e3"
  usr_dateOfBirth?: string; // "2003-03-04T00:00:00.000Z"
  createdAt?: string; // "2025-10-27T12:00:30.536Z"
  updatedAt?: string; // "2025-10-27T12:00:30.536Z"
  jti: string;
  [key: string]: any;
}

interface SocketWithUser extends Socket {
  userId?: string; // MongoDB _id
  user?: JwtPayload; // Full user payload
}

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
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/chat',
  // Thêm 2 dòng dưới đây để Server chấp nhận mọi loại kết nối
  transports: ['websocket', 'polling'],
  allowEIO3: true, // Cho phép tương thích ngược với các client đời cũ (nếu có)
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() io: Server;
  public get server(): Server {
    return this.io;
  }
  private readonly logger = new Logger(ChatGateway.name);
  private readonly key = REDISKEY;
  private ChatGrpcService: ChatGrpcService;
  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {}
  onModuleInit() {
    this.ChatGrpcService =
      this.chatClient.getService<ChatGrpcService>('ChatService');
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

      // Check JTI in Redis
      if (payload.jti && payload._id) {
        const redisResult: string | number | boolean | null =
          await this.redis.getData(
            this.key.REFRESH_TOKEN(payload._id, payload.jti),
          );
        const isValid =
          typeof redisResult === 'string' ||
          typeof redisResult === 'number' ||
          typeof redisResult === 'boolean'
            ? Boolean(redisResult)
            : !!redisResult;

        if (!isValid) {
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

      // tham gia vào các room của hệ thống
      await client.join([this.key.ROOM_CLIENT(payload.usr_id), 'system']);
      client.userId = payload._id;
      // Track socket id for this user (SET)
      await this.redis.sAdd(this.key.USER_ONLINE(client.userId), client.id);

      // Track user online status (String with TTL)
      // Value = ISO timestamp of when they came online or last refreshed
      await this.redis.setData(
        this.key.USER_PRESENCE(client.userId),
        new Date().toISOString(),
        REDIS_TTL.ONLINE_STATUS + 15, // buffer time
      );
      // Heartbeat Queue for Cron cleanliness
      await this.redis.zAdd(
        this.key.USERS_HEARTBEAT,
        Date.now(),
        client.userId,
      );

      await this.redis.setData(
        this.key.USER_LAST_SEEN(client.userId),
        new Date().toISOString(),
      );

      // Gắn user info vào socket
      client.user = payload;

      this.logger.log(
        `[CONNECT] User ${payload.usr_fullname} (${payload._id}) connected.`,
      );
      const roomIds = await this.redis.sMembers(
        this.key.USER_ROOMS(client.userId),
      );
      await client.join(roomIds);
      // Gửi thông báo đến người dùng
      this.io.to('system').emit(socketEvent.STATUS, {
        id: client.user.usr_id,
        isOnline: true,
        onlineAt: new Date(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit(socketEvent.VERYFIỄPTION, {
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
    const fullname = client.user?.usr_fullname;

    // Use scheduler to handle "true" offline after timeout,
    // BUT we can update the timestamp or remove if we want immediate offline effect
    // For now, let's just remove the specific socket ID from the user's socket track

    // Luôn kiểm tra user vì socket có thể disconnect vì lý do mạng,
    // hoặc client bị ngắt trước khi Guard kịp chạy.
    if (userId) {
      this.logger.log(
        `[DISCONNECT] User ${fullname} (${userId}) disconnected.`,
      );

      await this.redis.sRem(this.key.USER_ONLINE(userId), client.id);
      const checkOnline = await this.redis.sCard(this.key.USER_ONLINE(userId));

      // Nếu không còn socket nào của user này connected -> Remove presence
      if (checkOnline == 0) {
        await this.redis.delKey(this.key.USER_PRESENCE(userId));
        await this.redis.zRem(this.key.USERS_HEARTBEAT, userId);

        this.io.to('system').emit(socketEvent.STATUS, {
          id: client.user?.usr_id, // Use usr_id (string) for frontend consistency
          isOnline: false,
          lastSeen: new Date(),
        });
        this.io.emit('system', `${fullname} went offline.`);
      }
    }
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: SocketWithUser) {
    if (client.userId) {
      // Update existence of key with new TTL
      await this.redis.setData(
        this.key.USER_PRESENCE(client.userId),
        new Date().toISOString(),
        REDIS_TTL.ONLINE_STATUS + 15,
      );
      // Keep in heartbeat queue
      await this.redis.zAdd(
        this.key.USERS_HEARTBEAT,
        Date.now(),
        client.userId,
      );
    }
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
        this.ChatGrpcService.CreateNewMsg.bind(this.ChatGrpcService),
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
      const msg = result.metadata.msg;
      const memberIds = result.metadata.members.map(
        (member: Record<string, any>) => this.key.ROOM_CLIENT(member.id),
      );
      this.io.to(memberIds).emit(socketEvent.MSGUPSERT, msg);
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

  @SubscribeMessage('call:request')
  async handleCallRequest(
    @MessageBody()
    data: {
      actionUserId?: string;
      membersIds?: string[];
      roomId: string;
      callType: 'video' | 'audio';
      messageId?: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      // tạo tin nhắn cuộc gọi

      // bắt đầu tạo lịch sử cuộc gọi
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.RequestCall.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayCallResponse;

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Bắt đầu cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, callType, msg } = result.metadata;

      // await this.pushMessageToRoom(roomId, msgId, members, history);
      const otherMembers = room.room_members
        .filter((m) => m.id !== user.usr_id)
        .map((m) => this.key.ROOM_CLIENT(m.id));
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );

      const historyCall = {
        members: history.members,
        roomId: room.room_id,
        actionUserId: user.usr_id,
        callType: callType,
        callId: history.call_id,
      };
      this.io.to(otherMembers).emit('call:request', historyCall);
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error starting call:', error);
      client.emit('error', {
        message: 'Bắt đầu cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage(socketEvent.USERSATUS)
  async handleCheckUserStatus(
    @MessageBody() userIds: string[],
    @ConnectedSocket() client: SocketWithUser,
  ) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) return;

    // Optimized: Check presence keys using MGET
    const keys = userIds.map((uid) => this.key.USER_PRESENCE(uid));
    const results = await this.redis.mget(keys);

    results.forEach((val, index) => {
      if (val) {
        // val is the ISO string we stored
        const date = new Date(JSON.parse(val));
        if (!isNaN(date.getTime())) {
          client.emit(socketEvent.STATUS, {
            id: userIds[index],
            isOnline: true,
            onlineAt: date,
          });
        }
      }
    });
  }

  @SubscribeMessage('call:accepted')
  async handleAccept(
    @MessageBody()
    data: {
      actionUserId?: string;
      membersIds?: string[];
      roomId: string;
      offer: string;
      targetUserId: string;
      callId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      // trả lời cuộc gọi qua gRPC và tạo lịch sử cuộc gọi
      console.log('🚀 ~ ChatGateway ~ handleAccept ~ data:', data);
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.AcceptCall.bind(this.ChatGrpcService),
        {
          actionUserId: data.actionUserId,
          membersIds: data.membersIds,
          roomId: data.roomId,
          callId: data.callId,
        },
      )) as ChatGatewayCallResponse;
      console.log('🚀 ~ ChatGateway ~ handleAccept ~ result:', result);

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Trả lời cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg } = result.metadata;
      const targetSocketId = this.key.ROOM_CLIENT(data.targetUserId);
      this.io.to(targetSocketId).emit('call:accepted', {
        members: history.members,
        roomId: room.room_id,
        actionUserId: data.actionUserId,
        offer: data.offer,
        history: history,
        callId: data.callId,
      });
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error accept call:', error);
      client.emit('error', {
        message: 'Trả lời cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:answer')
  async handleAnswer(
    @MessageBody()
    data: {
      actionUserId?: string;
      targetUserId: string;
      roomId: string;
      answer: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      const targetSocketId = this.key.ROOM_CLIENT(data.targetUserId);
      // this.io.to(data.roomId).except(client.id).emit('call:answer', data);
      this.io.to(targetSocketId).emit('call:answer', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error answering call:', error);
      client.emit('error', {
        message: 'Trả lời cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:end')
  async handleEnd(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      status: CallStatus;
      callId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      // kết thúc cuộc gọi qua gRPC và tạo lịch sử cuộc gọi
      const result = (await Utils.dispatchGrpcRequest(
        this.ChatGrpcService.EndCall.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayCallResponse;

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Kết thúc cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg } = result.metadata;

      this.io.to(data.roomId).emit('call:end', {
        members: history.members,
        roomId: room.room_id,
        actionUserId: data.actionUserId,
        status: data.status,
        history: history,
        callId: data.callId,
      });
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      // await this.pushMessageToRoom(
      //   room.room_id,
      //   history.message_id?.toString() ?? '',
      //   history.members,
      //   history,
      // );

      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error ending call:', error);
      client.emit('error', {
        message: 'Kết thúc cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:share-screen')
  async handleShareScreen(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      isSharing: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      this.io.to(data.roomId).except(client.id).emit('call:share-screen', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error sharing screen:', error);
      client.emit('error', {
        message: 'Chia sẻ màn hình thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================
  // 🔔 SYSTEM EMITTER
  // ========================================================
  public emitRoomRefresh(roomId: string) {
    this.logger.log(`[ROOM_REFRESH] Emitting signal for room ${roomId}`);
    this.io.to(roomId).emit(socketEvent.ROOM_REFRESH, { roomId });
  }

  // ==== candidate
  @SubscribeMessage('call:candidate')
  async handleCandidate(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      candidate: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      this.io.to(data.roomId).except(client.id).emit('call:candidate', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error sending candidate:', error);
      client.emit('error', {
        message: 'Gửi candidate thất bại',
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
              const redisResult: unknown = await this.redis.getData(
                this.key.REFRESH_TOKEN(payload._id, payload.jti),
              );
              const isValid =
                typeof redisResult === 'string' ||
                typeof redisResult === 'number' ||
                typeof redisResult === 'boolean'
                  ? Boolean(redisResult)
                  : !!redisResult;

              if (isValid) {
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
    data: {
      ids?: unknown;
    },
  ) {
    // 1️⃣ Normalize input (bắt client gửi bậy)
    // 1️⃣ Normalize input (bắt client gửi bậy logic)
    // Client might send array directly OR object { ids: [] }
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
      (id): id is string => typeof id === 'string',
    );

    if (ids.length === 0) {
      return;
    }

    // 2️⃣ Gọi Redis an toàn (sử dụng MGET trên các key PRESENCE)
    const keys = ids.map((uid) => this.key.USER_PRESENCE(uid));
    let presenceValues: (string | null)[] = [];

    try {
      presenceValues = await this.redis.mget(keys);
    } catch (err) {
      console.error('❌ Redis mget failed:', err);
      return;
    }

    // 3️⃣ Map dữ liệu thành kết quả boolean
    // userId at ids[i] has presence if presenceValues[i] is truthy
    const socketResult = ids.map((userId, index) => ({
      id: userId,
      isOnline: !!presenceValues[index],
      onlineAt: new Date(),
    }));

    // 4️⃣ Emit 1 phát (KHÔNG spam)
    this.io.to('system').emit('status:online:bulk', {
      users: socketResult,
    });
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

interface ChatGatewayCallResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    history: CallHistory;
    room: Room;
    callType: string;
    msg: Record<string, any>;
  };
}
