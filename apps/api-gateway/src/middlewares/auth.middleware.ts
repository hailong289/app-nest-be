import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { Response as ResponseHelper } from 'libs/helpers/response';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res
        .status(401)
        .json(
          ResponseHelper.error(
            'Xác thực không thành công',
            401,
            'UNAUTHORIZED',
          ),
        );
    }

    const token = authHeader.replace('Bearer ', '');
    try {
      const jwtSecret = this.configService.get<string>(
        'GATEWAY_JWT_ACCESS_SECRET',
      );
      console.log('🚀 ~ AuthMiddleware ~ use ~ jwtSecret:', jwtSecret);
      interface JwtPayload {
        userId: string;
        username: string;
        // add other expected properties here
        [key: string]: any;
      }
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: jwtSecret,
      });
      (req as any).user = payload; // gắn user context vào request
      next();
    } catch {
      return res
        .status(401)
        .json(
          ResponseHelper.error(
            'Mã xác thực không hợp lệ hoặc đã hết hạn',
            401,
            'UNAUTHORIZED',
          ),
        );
    }
  }
}
