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
    // 1. Resolve token. Source priority:
    //    a. 'x-refresh-token' header → refresh-token flow (e.g. /auth/refresh-token endpoint)
    //    b. 'Authorization: Bearer …' header → legacy/explicit token
    //    c. HttpOnly `tokens` cookie (parsed JSON) → primary path post-migration
    //    Cookie fallback lets the browser auto-send credentials without
    //    JS-readable cookies — XSS-resistant + works for first-party
    //    requests that have `withCredentials: true`.
    const refreshTokenHeader = req.headers['x-refresh-token'];
    const authHeader = req.headers['authorization'];

    let token = '';
    let secretKey = '';
    let isRefreshToken = false;

    // Helper: pull tokens from the HttpOnly `tokens` cookie (JSON-encoded).
    // Returns { accessToken, refreshToken } or {} if cookie missing/malformed.
    const cookieTokens = (() => {
      const raw = (req as Request & { cookies?: Record<string, string> })
        .cookies?.tokens;
      if (!raw) return {} as { accessToken?: string; refreshToken?: string };
      try {
        return JSON.parse(raw) as {
          accessToken?: string;
          refreshToken?: string;
        };
      } catch {
        return {};
      }
    })();

    // --- CASE 1: XỬ LÝ REFRESH TOKEN ---
    // Header takes precedence; fall back to cookie's refreshToken when the
    // FE doesn't (or can't) set the x-refresh-token header anymore.
    if (refreshTokenHeader || cookieTokens.refreshToken) {
      // The /auth/refresh-token endpoint is the only consumer of refresh
      // tokens. Detect it by URL so other endpoints don't accidentally
      // accept a refresh token where they expect access.
      const isRefreshEndpoint = req.path?.includes('/auth/refresh-token');
      if (isRefreshEndpoint) {
        if (refreshTokenHeader) {
          const rawToken = Array.isArray(refreshTokenHeader)
            ? refreshTokenHeader[0]
            : refreshTokenHeader;
          token = rawToken.replace('Bearer ', '').trim();
        } else if (cookieTokens.refreshToken) {
          token = cookieTokens.refreshToken;
        }
        secretKey =
          this.configService.get<string>('GATEWAY_JWT_REFRESH_SECRET') ?? '';
        isRefreshToken = true;
      }
    }

    // --- CASE 2: XỬ LÝ ACCESS TOKEN ---
    if (!token && authHeader) {
      token = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )
        .replace('Bearer ', '')
        .trim();
      secretKey =
        this.configService.get<string>('GATEWAY_JWT_ACCESS_SECRET') ?? '';
    }

    // --- CASE 3: COOKIE FALLBACK (access token) ---
    if (!token && cookieTokens.accessToken) {
      token = cookieTokens.accessToken;
      secretKey =
        this.configService.get<string>('GATEWAY_JWT_ACCESS_SECRET') ?? '';
    }

    // --- CASE 4: KHÔNG CÓ TOKEN ---
    if (!token) {
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

      // 3. CHECK REDIS BLACKLIST
      // Pattern change (April 2026): Redis stores REVOKED JTIs only, not
      // active ones. Presence at REFRESH_TOKEN(userId, jti) means the
      // token has been revoked (logout / rotated / admin-banned).
      // Live tokens are NOT stored — they're considered valid as long
      // as JWT signature + exp pass + JTI is absent from blacklist.
      if (payload.jti && payload._id) {
        const redisKey = REDISKEY.REFRESH_TOKEN(payload._id, payload.jti);
        const isRevoked = await this.redisService.getData(redisKey);
        if (isRevoked) {
          return res
            .status(401)
            .json(
              ResponseHelper.error(
                'Phiên đăng nhập đã bị huỷ',
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
