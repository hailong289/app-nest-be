// rpc-jwt.guard.ts
import {
    CanActivate,
    ExecutionContext,
    HttpException,
    Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthJwtGuard implements CanActivate {
    constructor(private readonly jwtService: JwtService) { }

    canActivate(context: ExecutionContext): boolean {
        const data = context.switchToHttp().getRequest()?.headers || 
               context.switchToHttp().getRequest()?.body || 
               context.switchToRpc().getData();
        const token = data?.authorization?.split(' ')[1] || data?.token;
        if (!token) {
            throw new HttpException(
                {
                    message: 'Authorization token is required',
                    statusCode: 401,
                    reasonStatusCode: 'Unauthorized',
                    metadata: null
                },
                401
            );
        }

        try {
            const payload = this.jwtService.verify(token, {
                secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
            });

            // Gắn payload vào data, handler đọc được
            data.user = payload;
            return true;
        } catch {
            throw new HttpException(
                {
                    message: 'Invalid or expired token',
                    statusCode: 401,
                    reasonStatusCode: 'Unauthorized',
                    metadata: null
                },
                401
            );
        }
    }
}
