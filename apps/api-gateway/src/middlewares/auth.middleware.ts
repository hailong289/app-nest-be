import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { Response as ResponseHelper } from 'libs/helpers/response';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    console.log('AuthMiddleware - Authorization Header:', authHeader);
    if (!authHeader) {
       return res.status(401).json(ResponseHelper.error('Authorization header missing', 401, 'UNAUTHORIZED'));
    }

    const token = authHeader.replace('Bearer ', '');
    try {
      const jwtSecret = this.configService.get<string>('GATEWAY_JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, {
        secret: jwtSecret,
      });
      (req as any).user = payload; // gắn user context vào request
      next();
    } catch {
       return res.status(401).json(ResponseHelper.error('Invalid or expired token', 401, 'UNAUTHORIZED'));
    }
  }
}
