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
      this.io.to('system').emit('status', {
        userId: client.user.usr_id,
        isOnline: true,
      });
      // client.emit('status', {
      //   message: `Chào mừng ${payload.usr_fullname}, bạn đã online!`,
      // });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit('exception', {
        status: 'error',
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
    this.io.to('system').emit('status', {
      userId: client.userId,
      isOnline: false,
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
        this.io.to('system').emit('status', {
          userId: client.user?.usr_id,
          isOnline: false,
        });
        await this.redis.sRem(this.key.USERS_ONLINE, userId);
      }
    }
  }

  // ========================================================
  // 💬 CÁC SUBSCRIBE MESSAGE (Giữ nguyên)
  // ========================================================
  @SubscribeMessage('join')
  async join(
    @MessageBody() { roomId }: { roomId: string },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    const user = client.user; // payload từ JWT
    if (!user) return { ok: false, message: 'Unauthorized' }; // Join room

    await client.join(roomId);
    this.logger.log(`${user.usr_fullname} joined room ${roomId}`); // Broadcast đến mọi người trong room

    this.io.to(roomId).emit('system', `${user.usr_fullname} joined`);
    return { ok: true, user };
  }

  @SubscribeMessage('message:send')
  async onMessage(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      type: string;
      content: string;
      attachments?: Array<string>;
      replyTo: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    console.log('🚀 ~ ChatGateway ~ onMessage ~ data:', data);
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }
    console.log(user._id);

    data.userId = user._id;
    try {
      // Gọi gRPC service để tạo message
      const result = (await this.gatewayService.dispatchGrpcRequest(
        this.ChatGrpcService.CreateNewMsg.bind(this.ChatGrpcService),
        data,
      )) as ChatGatewayResponse;

      // Kiểm tra xem result có metadata hay không (trường hợp lỗi từ service)

      const memberUserIdOrther = result.metadata.members
        .filter((i) => i.user_id != user._id)
        .map((i) => i.user_id as string);
      // Emit message mới đến tất cả members trong room
      // Parallel processing để tăng performance

      await Promise.all(
        result.metadata.members.map(async (member) => {
          // Clone message để tránh mutate shared object

          // Get updated room data cho member
          const roomUpset = (await this.gatewayService.dispatchGrpcRequest(
            this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
            {
              userId: member.user_id as string,
              roomId: result.metadata.roomId,
            },
          )) as Record<string, any>;
          // get new message
          const newMsg = await this.gatewayService.dispatchGrpcRequest(
            this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
            {
              userId: member.user_id as string,
              msgId: result.metadata.msgId,
            },
          );
          // Emit cả room và message updates đến member's socket room
          const memberSocketRoom = this.key.ROOM_CLIENT(member.id);
          this.io.to(memberSocketRoom).emit('room:upset', roomUpset.metadata);
          this.io.to(memberSocketRoom).emit('message:upset', newMsg);
        }),
      );
      const body = {
        title: 'Tin nhắn mới',
        message: `Bạn có tin nhắn mới từ ${user.usr_fullname}`,
        userIds: memberUserIdOrther,
        data,
      };
      await this.gatewayService.dispatchServiceEvent(
        this.notificationClient,
        'push_notification_users',
        body,
      );

      return { ok: true, data: result };
    } catch (error) {
      this.logger.error(`[MESSAGE] Error creating message:`, error);
      this.io.emit('system:error:message:send', {
        data,
        error: error instanceof Error ? error.message : String(error),
      });
      // Nếu đã là WsException thì throw lại để filter xử lý
    }
  }

  @SubscribeMessage('mark:read')
  async MarkRead(
    @MessageBody()
    data: {
      userId?: string;
      roomId: string;
      lastMessageId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    console.log('🚀 ~ ChatGateway ~ onMessage ~ data:', data);
    const user = client.user;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }
    console.log(user._id);

    data.userId = user._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.ChatGrpcService.MarkReadUpTo.bind(this.ChatGrpcService),
      data,
    )) as ChatGatewayResponse;
    console.log('🚀 ~ ChatGateway ~ MarkRead ~ result:', result);
    this.io.to(this.key.ROOM_CLIENT(user.usr_id)).emit('mark:read', {
      lastMessageId: data.lastMessageId,
      roomId: data.roomId,
    });
    await Promise.all(
      result.metadata.members.map(async (member) => {
        // Clone message để tránh mutate shared object

        // Get updated room data cho member
        const roomUpset = (await this.gatewayService.dispatchGrpcRequest(
          this.ChatGrpcService.getRoom.bind(this.ChatGrpcService),
          {
            userId: member.user_id as string,
            roomId: result.metadata.roomId,
          },
        )) as Record<string, any>;
        // get new message
        const newMsg = await this.gatewayService.dispatchGrpcRequest(
          this.ChatGrpcService.GetOneMsg.bind(this.ChatGrpcService),
          {
            userId: member.user_id as string,
            msgId: result.metadata.msgId,
          },
        );
        // Emit cả room và message updates đến member's socket room
        const memberSocketRoom = this.key.ROOM_CLIENT(member.id);
        this.io.to(memberSocketRoom).emit('room:upset', roomUpset.metadata);
        this.io.to(memberSocketRoom).emit('message:upset', newMsg);
      }),
    );
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
