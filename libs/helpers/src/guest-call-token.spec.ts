import { JwtService } from '@nestjs/jwt';
import {
  buildGuestId,
  createGuestCallToken,
  guestTokenMatchesCall,
  isGuestUserId,
  verifyGuestCallToken,
} from './guest-call-token';

describe('guest-call-token', () => {
  const jwtService = new JwtService({});
  const secret = 'test-guest-call-secret';

  it('creates and verifies guest call token', () => {
    const { token, payload } = createGuestCallToken(jwtService, secret, {
      roomId: 'room-1',
      callId: 'call-1',
      callType: 'video',
      callMode: 'sfu',
      issuedBy: 'user-host',
      ttlSeconds: 3600,
    });

    const verified = verifyGuestCallToken(jwtService, secret, token);
    expect(verified.jti).toBe(payload.jti);
    expect(verified.roomId).toBe('room-1');
    expect(verified.callId).toBe('call-1');
    expect(verified.type).toBe('guest_call');
  });

  it('builds stable guest user id from jti', () => {
    expect(buildGuestId('abc-123')).toBe('guest:abc-123');
    expect(isGuestUserId('guest:abc-123')).toBe(true);
    expect(isGuestUserId('user-1')).toBe(false);
  });

  it('matches room/call scope', () => {
    const payload = {
      type: 'guest_call' as const,
      jti: 'j1',
      roomId: 'room-1',
      callId: 'call-1',
      callType: 'audio' as const,
      issuedBy: 'host',
    };
    expect(guestTokenMatchesCall(payload, 'room-1', 'call-1')).toBe(true);
    expect(guestTokenMatchesCall(payload, 'room-2', 'call-1')).toBe(false);
  });

  it('rejects tampered token', () => {
    const { token } = createGuestCallToken(jwtService, secret, {
      roomId: 'room-1',
      callId: 'call-1',
      callType: 'audio',
      issuedBy: 'host',
      ttlSeconds: 3600,
    });

    expect(() =>
      verifyGuestCallToken(jwtService, 'wrong-secret', token),
    ).toThrow();
  });
});
