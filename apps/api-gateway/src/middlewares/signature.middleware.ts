import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Response as ResponseHelper } from '@app/helpers/response';

@Injectable()
export class SignatureMiddleware implements NestMiddleware {
  constructor(private configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    try {
      const signature = req.headers['x-signature'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      const apiKey = req.headers['x-api-key'] as string;

      if (!signature || !timestamp || !apiKey) {
        return res
          .status(401)
          .json(
            ResponseHelper.error(
              'Thiếu thông tin xác thực',
              401,
              'UNAUTHORIZED',
            ),
          );
      }

      // Kiểm tra tính hợp lệ của timestamp (ví dụ: không quá 5 phút)
      const currentTime = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp, 10);
      if (currentTime - requestTime > 300) {
        // 5 minutes
        return res
          .status(401)
          .json(
            ResponseHelper.error('Yêu cầu đã hết hạn', 401, 'UNAUTHORIZED'),
          );
      }

      // Tạo payload để ký
      let payload = '';

      // Sử dụng query parameters cho GET requests
      if (req.method === 'GET') {
        const queryParams = new URLSearchParams(req.query as any).toString();
        payload = `${req.method}${req.path}${queryParams}${timestamp}`;
      } else {
        // Sử dụng body cho các phương thức khác (POST, PUT, DELETE, ...)
        payload = `${req.method}${req.path}${JSON.stringify(req.body)}${timestamp}`;
      }

      // Tạo chữ ký từ payload và secret key
      const expectedSignature = crypto
        .createHmac(
          'sha256',
          this.configService.get<string>(`API_KEY_SECRET`) || '',
        )
        .update(payload)
        .digest('hex');

      // Compare signatures
      if (signature !== expectedSignature) {
        return res
          .status(401)
          .json(
            ResponseHelper.error('Chữ ký không hợp lệ', 401, 'UNAUTHORIZED'),
          );
      }

      next();
    } catch (error) {
      console.error('SignatureMiddleware error:', error);
      return res
        .status(500)
        .json(
          ResponseHelper.error(
            'Xác thực chữ ký thất bại',
            500,
            'INTERNAL_SERVER_ERROR',
          ),
        );
    }
  }
}
