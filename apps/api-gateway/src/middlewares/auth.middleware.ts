import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { Response as ResponseHelper } from 'libs/helpers/response';
import { RedisService } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  // Thêm logger để dễ debug nếu cần
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Lấy token từ header
    // Ưu tiên 'x-refresh-token' nếu có, không thì lấy 'authorization'
    const refreshTokenHeader = req.headers['x-refresh-token'];
    const authHeader = req.headers['authorization'];

    let token = '';
    let secretKey = '';
    let isRefreshToken = false;

    // --- CASE 1: XỬ LÝ REFRESH TOKEN ---
    if (refreshTokenHeader) {
      const rawToken = Array.isArray(refreshTokenHeader)
        ? refreshTokenHeader[0]
        : refreshTokenHeader;

      // Quan trọng: Remove "Bearer " và khoảng trắng thừa (nếu có)
      token = rawToken.replace('Bearer ', '').trim();

      // Lấy Secret riêng cho Refresh Token
      secretKey =
        this.configService.get<string>('GATEWAY_JWT_REFRESH_SECRET') ?? '';
      isRefreshToken = true;
    }
    // --- CASE 2: XỬ LÝ ACCESS TOKEN ---
    else if (authHeader) {
      // Remove "Bearer "
      token = authHeader.replace('Bearer ', '').trim();

      // Lấy Secret cho Access Token
      secretKey =
        this.configService.get<string>('GATEWAY_JWT_ACCESS_SECRET') ?? '';
    }
    // --- CASE 3: KHÔNG CÓ TOKEN ---
    else {
      return res
        .status(401)
        .json(
          ResponseHelper.error(
            'Yêu cầu xác thực: Không tìm thấy Token',
            401,
            'UNAUTHORIZED',
          ),
        );
    }

    // Nếu secret chưa cấu hình trong .env thì báo lỗi server (để dev biết đường fix)
    if (!secretKey) {
      this.logger.error(
        `Thiếu cấu hình Secret Key cho ${isRefreshToken ? 'Refresh' : 'Access'} Token`,
      );
      return res
        .status(500)
        .json(
          ResponseHelper.error(
            'Lỗi cấu hình hệ thống (Missing Secret)',
            500,
            'INTERNAL_SERVER_ERROR',
          ),
        );
    }

    try {
      // Định nghĩa kiểu dữ liệu cho Payload
      interface JwtPayload {
        _id: string;
        jti: string;
        usr_status?: string;
        [key: string]: any;
      }

      // 2. VERIFY TOKEN
      // Bước này check chữ ký (signature) và hạn sử dụng (exp)
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: secretKey,
      });

      // 3. CHECK REDIS (Bảo mật nâng cao)
      // Kiểm tra xem token này có còn hợp lệ trong Redis không (đặc biệt quan trọng cho Refresh Token)
      if (payload.jti && payload._id) {
        // Lưu ý: Logic này giả định key Redis lưu state của Refresh Token.
        // Nếu Access Token không lưu Redis thì logic này có thể skip cho Access Token tuỳ business của ông.
        // Nhưng ở đây tôi giữ nguyên logic check cho cả 2 như ông yêu cầu.
        const redisKey = REDISKEY.REFRESH_TOKEN(payload._id, payload.jti);

        const redisResult: unknown = await this.redisService.getData(redisKey);

        const isValid =
          typeof redisResult === 'string' ||
          typeof redisResult === 'number' ||
          typeof redisResult === 'boolean'
            ? Boolean(redisResult)
            : !!redisResult;

        // Nếu Refresh Token mà không tìm thấy trong Redis -> Coi như đã logout/hết hạn
        if (!isValid) {
          return res
            .status(401)
            .json(
              ResponseHelper.error(
                'Phiên đăng nhập đã hết hạn hoặc đã bị huỷ',
                401,
                'UNAUTHORIZED',
              ),
            );
        }
      }

      // 4. CHECK TRẠNG THÁI USER
      if (payload.usr_status && payload.usr_status !== 'active') {
        return res
          .status(403)
          .json(
            ResponseHelper.error(
              'Tài khoản hiện không hoạt động',
              403,
              'FORBIDDEN',
            ),
          );
      }

      // 5. GẮN USER VÀO REQUEST
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { iat, exp, ...userData } = payload;

      // Gắn data user đã clean vào request
      (req as Record<string, any>).user = userData;

      // Gắn thêm cờ để Controller biết request này dùng loại token nào (nếu cần xử lý logic riêng)
      (req as Record<string, any>).authInfo = {
        isRefreshToken,
        jti: payload.jti,
        tokenType: isRefreshToken ? 'refresh' : 'access',
      };

      next();
    } catch (err) {
      console.log('🚀 ~ AuthMiddleware ~ use ~ err:', err);
      // Catch lỗi verify (hết hạn, sai chữ ký, format sai...)

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
