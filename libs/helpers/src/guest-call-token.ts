import { randomUUID } from 'crypto';
import type { JwtService } from '@nestjs/jwt';
import type {
  GuestCallLinkMeta,
  GuestCallTokenPayload,
  GuestCallType,
  GuestCallMode,
} from 'libs/types/guest-call.type';

export const GUEST_CALL_TOKEN_TYPE = 'guest_call' as const;

export function buildGuestId(jti: string): string {
  return `guest:${jti}`;
}

export function isGuestUserId(userId?: string | null): boolean {
  return typeof userId === 'string' && userId.startsWith('guest:');
}

export function createGuestCallToken(
  jwtService: JwtService,
  secret: string,
  input: {
    roomId: string;
    callId: string;
    callType: GuestCallType;
    callMode?: GuestCallMode;
    issuedBy: string;
    ttlSeconds: number;
    guestName?: string;
    jti?: string;
  },
): { token: string; payload: GuestCallTokenPayload; meta: GuestCallLinkMeta } {
  const jti = input.jti || randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, input.ttlSeconds);

  const payload: GuestCallTokenPayload = {
    type: GUEST_CALL_TOKEN_TYPE,
    jti,
    roomId: input.roomId,
    callId: input.callId,
    callType: input.callType,
    callMode: input.callMode,
    issuedBy: input.issuedBy,
    guestName: input.guestName,
    iat: now,
    exp,
  };

  const token = jwtService.sign(payload, {
    secret,
  });

  const meta: GuestCallLinkMeta = {
    jti,
    roomId: input.roomId,
    callId: input.callId,
    callType: input.callType,
    callMode: input.callMode,
    issuedBy: input.issuedBy,
    createdAt: new Date(now * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    useCount: 0,
  };

  return { token, payload, meta };
}

export function verifyGuestCallToken(
  jwtService: JwtService,
  secret: string,
  token: string,
): GuestCallTokenPayload {
  const payload = jwtService.verify<GuestCallTokenPayload>(token, { secret });
  if (payload?.type !== GUEST_CALL_TOKEN_TYPE) {
    throw new Error('INVALID_GUEST_CALL_TOKEN');
  }
  if (!payload.jti || !payload.roomId || !payload.callId) {
    throw new Error('INVALID_GUEST_CALL_TOKEN');
  }
  return payload;
}

export function guestTokenMatchesCall(
  payload: GuestCallTokenPayload,
  roomId: string,
  callId: string,
): boolean {
  return payload.roomId === roomId && payload.callId === callId;
}
