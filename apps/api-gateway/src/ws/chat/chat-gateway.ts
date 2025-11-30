import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';
import type { ClientGrpc, ClientKafka } from '@nestjs/microservices';
import { GatewayService } from '../../gateway/gateway.service';
import { SERVICES } from '@app/constants';
import { notifyType, socketEvent } from '../../../../../libs/dto/src/enum.type';
import { RoomTypeEnum } from 'libs/db/src/mongo/model/room.model';

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
  [key: string]: any;
}

interface SocketWithUser extends Socket {
  userId?: string; // MongoDB _id
  user?: JwtPayload; // Full user payload
}
export interface ChatGrpcService {
  CreateNewMsg(data: any): any;
  getRoom(data: any): any;
  GetOneMsg(data: any): any;
  MarkReadUpTo(data: any): any;
  HandleReact(data: any): any;
  HandlePinned(data: any): any;
  HandleDeleteForUser(data: any): any;
  HandleDelete(data: any): any;
}
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly key = REDISKEY;
  private ChatGrpcService: ChatGrpcService;
  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
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
      // tham gia vào các room của hệ thống
      await client.join([this.key.ROOM_CLIENT(payload.usr_id), 'system']);
      client.userId = payload._id;
      await this.redis.sAdd(this.key.USER_ONLINE(client.userId), client.id);
      await this.redis.sAdd(this.key.USERS_ONLINE, client.userId);
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
    this.io.to('system').emit(socketEvent.STATUS, {
      id: client.userId,
      isOnline: false,
      onlineAt: new Date(),
    });
    // Luôn kiểm tra user vì socket có thể disconnect vì lý do mạng,
    // hoặc client bị ngắt trước khi Guard kịp chạy.
    if (userId) {
      this.logger.log(
        `[DISCONNECT] User ${fullname} (${userId}) disconnected.`,
      );

      // 💡 TIPS: Ở đây bạn có thể dùng Redis để set user này là OFFLINE.
      // Ví dụ: this.redisService.setUserOffline(userId);

      // Broadcast thông báo cho mọi người biết user này đã offline
      // (Lưu ý: Nếu user đang ở trong room, bạn có thể emit vào room đó)
      this.io.emit('system', `${fullname} went offline.`);
      await this.redis.sRem(this.key.USER_ONLINE(userId), client.id);
      const checkOnline = await this.redis.sCard(this.key.USER_ONLINE(userId));
      if (checkOnline == 0) {
        this.io.to('system').emit('status:online', {
          id: client.user?.usr_id,
          isOnline: false,
        });
        await this.redis.sRem(this.key.USERS_ONLINE, userId);
      }
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
    const user = client.user; // payload từ JWT
    if (!user) return { ok: false, message: 'Unauthorized' }; // Join room

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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    // this.logger.log(
    //   `[CONNECT] User ${payload.usr_fullname} (${payload._id}) connected.`,
    // );
    try {
      // Tạo message qua gRPC
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.CreateNewMsg.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      const { msgId, roomId, members } = result.metadata;

      // Lấy danh sách userId của members khác (để gửi notification)
      // const otherMemberUserIds = members
      //   .filter((m) => m.user_id !== user._id)
      //   .map((m) => m.user_id as string);

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          // Gọi song song getRoom và GetOneMsg
          const [roomData, msgData] = await Promise.all([
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
              { userId: memberUserId, roomId },
            ) as Promise<RoomGatewayResponse>,
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId },
            ),
          ]);
          if (member.user_id !== user._id && !roomData?.metadata?.mute) {
            const title =
              roomData.metadata.type === RoomTypeEnum.Private
                ? `${user.usr_fullname} gửi 1 tin nhắn đến bạn`
                : `${user.usr_fullname} gửi 1 tin nhắn đến ${roomData.metadata.name}`;
            await this.gatewayService.dispatchServiceEvent(
              this.notificationClient,
              'push_notification_users',
              {
                title,
                message:
                  roomData.metadata.last_message &&
                  typeof roomData.metadata.last_message === 'object' &&
                  roomData.metadata.last_message !== null &&
                  'content' in roomData.metadata.last_message
                    ? ((roomData.metadata.last_message as { content?: string })
                        ?.content ?? '')
                    : '',
                userIds: [member.user_id],
                data: {
                  type: notifyType.noify_new_message,
                  room: roomData.metadata,
                  msg: msgData,
                },
              },
            );
          }
          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData,
          };
        }),
      );

      // Emit events đến từng member
      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
      });

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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Đánh dấu đã đọc qua gRPC
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.MarkReadUpTo.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      // Kiểm tra result có metadata không
      if (!result || !result.metadata) {
        this.logger.error(
          '[MARK_READ] Invalid response from MarkReadUpTo:',
          result,
        );
        client.emit('error', { message: 'Failed to mark as read' });
        return { ok: false };
      }

      const { msgId, roomId, members } = result.metadata;

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          // Gọi song song getRoom và GetOneMsg
          const [roomData, msgData] = await Promise.all([
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
              { userId: memberUserId, roomId },
            ) as Promise<ChatGatewayResponse>,
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId },
            ),
          ]);

          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData,
          };
        }),
      );

      // Emit events đến từng member
      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
      });

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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }
    data.userId = user._id;
    try {
      // Tạo message qua gRPC
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.HandleReact.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      const { msgId, roomId, members } = result.metadata;
      // Lấy danh sách userId của members khác (để gửi notification)

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          // Gọi song song getRoom và GetOneMsg
          const [roomData, msgData] = await Promise.all([
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
              { userId: memberUserId, roomId },
            ) as Promise<RoomGatewayResponse>,
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId },
            ),
          ]);
          if (member.user_id !== user._id && !roomData?.metadata?.mute) {
            const title =
              roomData.metadata.type === RoomTypeEnum.Private
                ? `${user.usr_fullname} thả cảm xúc đến bạn`
                : `${user.usr_fullname} thả  cảm xúc đến tin nhắn của nhóm ${roomData.metadata.name}`;
            await this.gatewayService.dispatchServiceEvent(
              this.notificationClient,
              'push_notification_users',
              {
                title,
                message:
                  roomData.metadata.last_message &&
                  typeof roomData.metadata.last_message === 'object' &&
                  roomData.metadata.last_message !== null &&
                  'content' in roomData.metadata.last_message
                    ? ((roomData.metadata.last_message as { content?: string })
                        ?.content ?? '')
                    : '',
                userIds: [member.user_id],
                data: {
                  type: notifyType.noify_new_message,
                  room: roomData.metadata,
                  msg: msgData,
                },
              },
            );
          }
          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData,
          };
        }),
      );

      // Emit events đến từng member
      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
      });

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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;
    console.log('🚀 ~ ChatGateway ~ on pinned ~ data:', data);

    try {
      // Tạo message qua gRPC
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.HandlePinned.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      const { msgId, roomId, members } = result.metadata;

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          // Gọi song song getRoom và GetOneMsg
          const [roomData, msgData] = await Promise.all([
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
              { userId: memberUserId, roomId },
            ) as Promise<ChatGatewayResponse>,
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId },
            ),
          ]);

          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData,
          };
        }),
      );

      // Emit events đến từng member
      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
      });

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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Tạo message qua gRPC
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.HandleDeleteForUser.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayDeleteResponse;

      // Defensive: metadata may be missing
      const metadata = result?.metadata ?? {};
      const msgIds: string[] = Array.isArray(metadata.msgIds)
        ? metadata.msgIds
        : [];
      const roomId: string = metadata.roomId;
      const members: Array<Record<string, any>> = Array.isArray(
        metadata.members,
      )
        ? metadata.members
        : [];

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          const roomDataPromise = this.gatewayService.dispatchGrpcRequest(
            this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
            { userId: memberUserId, roomId },
          ) as Promise<ChatGatewayResponse>;

          const msgDataPromises = msgIds.map((mId: string) =>
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId: mId },
            ),
          );

          const [roomData, msgDatas] = await Promise.all([
            roomDataPromise,
            Promise.all(msgDataPromises),
          ]);

          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData: msgDatas ?? [],
          };
        }),
      );

      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        if (Array.isArray(msgData)) {
          msgData.forEach((m) =>
            this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, m),
          );
        } else {
          this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
        }
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
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    data.userId = user._id;

    try {
      // Gọi đúng hàm HandleDelete (recall) thay vì HandleDeleteForUser
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.HandleDelete.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayDeleteResponse;

      // Defensive: metadata may be missing
      const metadata = result?.metadata ?? {};
      const msgIds: string[] = Array.isArray(metadata.msgIds)
        ? metadata.msgIds
        : [];
      const roomId: string = metadata.roomId;
      const members: Array<Record<string, any>> = Array.isArray(
        metadata.members,
      )
        ? metadata.members
        : [];

      // Batch gọi getRoom và GetOneMsg cho tất cả members song song
      const memberUpdates = await Promise.all(
        members.map(async (member) => {
          const memberUserId = member.user_id as string;

          const roomDataPromise = this.gatewayService.dispatchGrpcRequest(
            this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
            { userId: memberUserId, roomId },
          ) as Promise<ChatGatewayResponse>;

          const msgDataPromises = msgIds.map((mId: string) =>
            this.gatewayService.dispatchGrpcRequest(
              this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
              { userId: memberUserId, msgId: mId },
            ),
          );

          const [roomData, msgDatas] = await Promise.all([
            roomDataPromise,
            Promise.all(msgDataPromises),
          ]);

          return {
            socketRoom: this.key.ROOM_CLIENT(member.id),
            roomData: roomData.metadata,
            msgData: msgDatas ?? [],
          };
        }),
      );

      memberUpdates.forEach(({ socketRoom, roomData, msgData }) => {
        this.io.to(socketRoom).emit(socketEvent.ROOMUPSERT, roomData);
        if (Array.isArray(msgData)) {
          msgData.forEach((m) =>
            this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, m),
          );
        } else {
          this.io.to(socketRoom).emit(socketEvent.MSGUPSERT, msgData);
        }
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
  @SubscribeMessage(socketEvent.USERSATUS)
  async CheckUserOnline(
    @MessageBody()
    data: {
      ids: string[];
    },
  ) {
    const result = (await this.redis.SisMembers({
      key: this.key.USERS_ONLINE,
      values: data.ids,
    })) as Array<{
      key: string;
      value: boolean;
    }>;
    if (result) {
      const socketResult = result.map((i: { key: string; value: boolean }) => ({
        id: i.key,
        isOnline: i.value,
      }));
      console.log(
        '🚀 ~ ChatGateway ~ CheckUserOnline ~ socketResult:',
        socketResult,
      );
      for (const i of socketResult) {
        this.io.to('system').emit('status:online', {
          id: i.id,
          isOnline: i.isOnline,
          onlineAt: new Date(),
        });
      }
    }

    // this.io.emit('status_online', result);
  }
  @SubscribeMessage(socketEvent.USERTYPING)
  onTypingIndicator(
    @MessageBody()
    data: {
      roomId: string;
      typing: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    const user = {
      id: client.user?.usr_id,
      name: client.user?.usr_fullname,
      avatar: client.user?.usr_avatar,
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
    // Có thể bổ sung các trường khác nếu cần
  };
}

interface ChatGatewayDeleteResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    msgIds: string[];
    members: Array<Record<string, any>>;
    roomId: string;
    // Có thể bổ sung các trường khác nếu cần
  };
}

interface RoomGatewayResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: Record<string, any>;
}
