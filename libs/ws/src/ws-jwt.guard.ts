import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

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
  userId?: string; // Sẽ lưu _id từ MongoDB
  user?: JwtPayload; // Full payload
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client: SocketWithUser = context.switchToWs().getClient<Socket>();

    // Lấy token từ nhiều nguồn: auth object, query params, hoặc headers
    let token: string | undefined =
      (client.handshake.auth?.token as string) || // Socket.IO auth object (recommended)
      (client.handshake.query?.token as string) || // Query params
      (client.handshake.headers?.authorization as string); // Authorization header

    if (!token) {
      this.logger.warn(
        `[WsJwtGuard] No token provided from client ${client.id}`,
      );
      client.emit('exception', {
        status: 'error',
        message: 'Xác thực không thành công - Token không được cung cấp',
      });
      return false;
    }

    // Nếu token có prefix "Bearer ", loại bỏ nó
    if (token.startsWith('Bearer ')) {
      token = token.replace('Bearer ', '');
    }

    try {
      const jwtSecret = this.configService.get<string>(
        'GATEWAY_JWT_ACCESS_SECRET',
      );

      if (!jwtSecret) {
        this.logger.error('[WsJwtGuard] JWT secret not configured');
        return false;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: jwtSecret,
      });

      // Gắn toàn bộ payload vào socket
      client.userId = payload._id; // MongoDB _id
      client.user = payload; // Full user info

      this.logger.log(
        `[WsJwtGuard] Authentication successful for user ${payload._id} (${payload.usr_fullname})`,
      );

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[WsJwtGuard] Token verification failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit('exception', {
        status: 'error',
        message: 'Mã xác thực không hợp lệ hoặc đã hết hạn',
      });
      return false;
    }
  }
}
