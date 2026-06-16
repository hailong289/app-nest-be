import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Inject, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { SERVICES } from '@app/constants';
import { REDISKEY, REDIS_TTL } from '@app/constants/RedisKey';
import { RedisService } from 'libs/db/src';
import {
  buildGuestId,
  createGuestCallToken,
  verifyGuestCallToken,
} from 'libs/helpers/src/guest-call-token';
import type { GuestCallLinkMeta } from 'libs/types/guest-call.type';
import { GatewayService } from '../gateway/gateway.service';

interface ChatGrpcService {
  GetCallStatus(data: { callId: string }): Observable<any>;
}

export interface CreateGuestCallLinkDto {
  roomId: string;
  callId: string;
  callType: 'video' | 'audio';
  callMode?: 'p2p' | 'sfu';
  ttlMinutes?: number;
}

@Injectable()
export class GuestCallLinkService implements OnModuleInit {
  private readonly logger = new Logger(GuestCallLinkService.name);
  private chatService!: ChatGrpcService;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.chatService = this.chatClient.getService<ChatGrpcService>('ChatService');
  }

  private getSecret(): string {
    return (
      this.configService.get<string>('GUEST_CALL_JWT_SECRET') ||
      this.configService.get<string>('GATEWAY_JWT_ACCESS_SECRET') ||
      ''
    );
  }

  private getDefaultTtlSeconds(): number {
    const minutes = Number(
      this.configService.get<string>('GUEST_CALL_LINK_TTL_MINUTES') || 60,
    );
    return Math.max(15, minutes) * 60;
  }

  private getFrontendBaseUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') ||
      'http://localhost:3000'
    );
  }

  async createLink(issuedBy: string, body: CreateGuestCallLinkDto) {
    if (!body.roomId || !body.callId || !body.callType) {
      throw new BadRequestException('Thiếu roomId, callId hoặc callType');
    }

    if (body.callMode && body.callMode !== 'sfu') {
      throw new BadRequestException(
        'Link mời khách chỉ hỗ trợ cuộc gọi nhóm (SFU)',
      );
    }

    const status = (await this.gatewayService.dispatchGrpcRequest(
      (d) => this.chatService.GetCallStatus(d),
      { callId: body.callId },
    )) as {
      statusCode?: number;
      metadata?: { exists?: boolean; ended?: boolean };
    };

    if (status?.metadata?.ended || status?.metadata?.exists === false) {
      throw new BadRequestException('Cuộc gọi không tồn tại hoặc đã kết thúc');
    }

    const secret = this.getSecret();
    if (!secret) {
      throw new BadRequestException('Guest call JWT secret chưa cấu hình');
    }

    const ttlSeconds =
      body.ttlMinutes && body.ttlMinutes > 0
        ? body.ttlMinutes * 60
        : this.getDefaultTtlSeconds();

    const { token, meta } = createGuestCallToken(this.jwtService, secret, {
      roomId: body.roomId,
      callId: body.callId,
      callType: body.callType,
      callMode: 'sfu',
      issuedBy,
      ttlSeconds,
    });

    await this.redis.setData(
      REDISKEY.GUEST_CALL_LINK(meta.jti),
      meta,
      ttlSeconds,
    );

    const base = this.getFrontendBaseUrl().replace(/\/+$/, '');
    const params = new URLSearchParams({
      guestToken: token,
      roomId: body.roomId,
      callId: body.callId,
      callType: body.callType,
      callMode: 'sfu',
      status: 'joined',
    });
    const url = `${base}/call?${params.toString()}`;

    return {
      token,
      url,
      jti: meta.jti,
      expiresAt: meta.expiresAt,
      roomId: body.roomId,
      callId: body.callId,
      callType: body.callType,
      callMode: 'sfu',
    };
  }

  async revokeLink(issuedBy: string, jti: string) {
    if (!jti) {
      throw new BadRequestException('Thiếu jti');
    }

    const meta = await this.redis.getData<GuestCallLinkMeta>(
      REDISKEY.GUEST_CALL_LINK(jti),
    );
    if (!meta) {
      throw new BadRequestException('Link không tồn tại hoặc đã hết hạn');
    }
    if (meta.issuedBy !== issuedBy) {
      throw new UnauthorizedException('Không có quyền thu hồi link này');
    }

    const ttl = Math.max(
      60,
      Math.floor((new Date(meta.expiresAt).getTime() - Date.now()) / 1000),
    );
    await this.redis.setData(
      REDISKEY.GUEST_CALL_LINK_REVOKED(jti),
      '1',
      ttl > 0 ? ttl : REDIS_TTL.SESSION,
    );
    await this.redis.delKey(REDISKEY.GUEST_CALL_LINK(jti));

    return { ok: true, jti };
  }

  async verifyToken(token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('Thiếu token');
    }

    const secret = this.getSecret();
    if (!secret) {
      throw new BadRequestException('Guest call JWT secret chưa cấu hình');
    }

    let payload;
    try {
      payload = verifyGuestCallToken(this.jwtService, secret, token.trim());
    } catch {
      return {
        valid: false,
        reason: 'invalid_token',
      };
    }

    const revoked = await this.redis.getData<string>(
      REDISKEY.GUEST_CALL_LINK_REVOKED(payload.jti),
    );
    if (revoked) {
      return { valid: false, reason: 'revoked', jti: payload.jti };
    }

    const meta = await this.redis.getData<GuestCallLinkMeta>(
      REDISKEY.GUEST_CALL_LINK(payload.jti),
    );
    if (!meta) {
      return { valid: false, reason: 'expired_or_unknown', jti: payload.jti };
    }

    const status = (await this.gatewayService.dispatchGrpcRequest(
      (d) => this.chatService.GetCallStatus(d),
      { callId: payload.callId },
    )) as {
      metadata?: { exists?: boolean; ended?: boolean };
    };

    if (status?.metadata?.ended || status?.metadata?.exists === false) {
      return { valid: false, reason: 'call_ended', jti: payload.jti };
    }

    if (meta) {
      meta.useCount = (meta.useCount || 0) + 1;
      const ttl = Math.max(
        60,
        Math.floor((new Date(meta.expiresAt).getTime() - Date.now()) / 1000),
      );
      if (ttl > 0) {
        await this.redis.setData(REDISKEY.GUEST_CALL_LINK(payload.jti), meta, ttl);
      }
    }

    return {
      valid: true,
      guestId: buildGuestId(payload.jti),
      roomId: payload.roomId,
      callId: payload.callId,
      callType: payload.callType,
      callMode: payload.callMode || 'sfu',
      expiresAt: meta?.expiresAt,
      jti: payload.jti,
    };
  }
}
