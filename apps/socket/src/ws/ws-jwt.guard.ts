import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import * as NestConfig from '@nestjs/config';
import * as NestJwt from '@nestjs/jwt';

interface JwtPayload {
  _id: string; // MongoDB _id
  usr_fullname: string;
  usr_email: string;
  usr_phone?: string;
  usr_avatar?: string;
  usr_gender?: string;
  usr_status?: string;
  usr_id: string;
  usr_slug: string;
  usr_dateOfBirth?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

interface SocketWithUser extends Socket {
  userId?: string;
  user?: JwtPayload;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly configService: NestConfig.ConfigService,
    private readonly jwtService: NestJwt.JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client: SocketWithUser = context.switchToWs().getClient<Socket>();

    let token: string | undefined =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string) ||
      (client.handshake.headers?.authorization as string);

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

      client.userId = payload._id;
      client.user = payload;

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
