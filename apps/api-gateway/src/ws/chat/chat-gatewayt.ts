import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection, // ⬅️ IMPORT HOOK NÀY
  OnGatewayDisconnect, // ⬅️ VÀ HOOK NÀY
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { WsJwtGuard } from 'libs/ws/src/ws-jwt.guard';
import { Server, Socket } from 'socket.io';

interface SocketWithUser extends Socket {
  userId: string;
}

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // ⬅️ IMPLEMENT CÁC HOOK Ở ĐÂY
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(ChatGateway.name);

  // ========================================================
  // 🟢 HÀM XỬ LÝ KẾT NỐI (HANDLING CONNECTION)
  // ========================================================
  handleConnection(client: SocketWithUser, ...args: any[]) {
    // Nếu Guard chạy thành công, client.user sẽ tồn tại
    const userId = client.userId;

    // Nếu user không tồn tại, có nghĩa là Auth thất bại (Guard ném Unauthorized)
    // và kết nối sẽ bị ngắt qua logic trong RedisIoAdapter/Middleware.
    // Nếu nó đã qua được đến đây, ta coi là hợp lệ.
    this.logger.log(`[CONNECT] User (${userId}) connected.`);
    if (userId) {
      // 💡 TIPS: Ở đây bạn có thể dùng Redis để set user này là ONLINE.
      // Ví dụ: this.redisService.setUserOnline(userId);

      // Gửi thông báo đến người dùng đó (hoặc tất cả)
      client.emit('status', {
        message: `Chào mừng , bạn đã online!`,
      });
    } else {
      // Dòng này thường không chạy vì Adapter đã ngắt kết nối nếu không có Auth
      // client.disconnect(true);
      this.logger.warn(`[CONNECT] Unauthorized client attempted connection.`);
    }
  }

  // ========================================================
  // 🔴 HÀM XỬ LÝ NGẮT KẾT NỐI (HANDLING DISCONNECT)
  // ========================================================
  handleDisconnect(client: SocketWithUser) {
    const userId = client.userId;

    // Luôn kiểm tra user vì socket có thể disconnect vì lý do mạng,
    // hoặc client bị ngắt trước khi Guard kịp chạy.
    if (userId) {
      this.logger.log(`[DISCONNECT] User  (${userId}) disconnected.`);

      // 💡 TIPS: Ở đây bạn có thể dùng Redis để set user này là OFFLINE.
      // Ví dụ: this.redisService.setUserOffline(userId);

      // Broadcast thông báo cho mọi người biết user này đã offline
      // (Lưu ý: Nếu user đang ở trong room, bạn có thể emit vào room đó)
      this.io.emit('system', ` went offline.`);
    }
  } // 🟢 userId được guard decode sẵn

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
    this.logger.log(` joined room ${roomId}`); // Broadcast đến mọi người trong room

    this.io.to(roomId).emit('system', ` joined`);
    return { ok: true, user };
  }

  @SubscribeMessage('message')
  onMessage(
    @MessageBody() data: { roomId: string; text: string },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    const user = client.user;
    if (!user) return { ok: false };

    this.io.to(data.roomId).emit('message', {
      userId: userId,
      username: user.username,
      text: data.text,
      sentAt: new Date().toISOString(),
    });

    return { ok: true };
  }
}
