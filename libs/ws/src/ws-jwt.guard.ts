import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
interface SocketWithUser extends Socket {
  userId?: string;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const client: SocketWithUser = context.switchToWs().getClient<Socket>();
    const token = client.handshake.headers.authorization;
    if (!token) return false;
    try {
      const jwtSecret = this.configService.get<string>(
        'GATEWAY_JWT_ACCESS_SECRET',
      );
      interface JwtPayload {
        userId: string;
        username: string;
        // add other expected properties here
        [key: string]: any;
      }
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: jwtSecret,
      });

      client.userId = payload.userId;
      return true;
    } catch {
      return false;
    }
  }
}
