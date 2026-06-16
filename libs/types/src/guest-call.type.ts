export type GuestCallType = 'video' | 'audio';
export type GuestCallMode = 'p2p' | 'sfu';

/** JWT claims for guest call invite links */
export interface GuestCallTokenPayload {
  type: 'guest_call';
  jti: string;
  roomId: string;
  callId: string;
  callType: GuestCallType;
  callMode?: GuestCallMode;
  issuedBy: string;
  guestName?: string;
  iat?: number;
  exp?: number;
}

export interface GuestCallLinkMeta {
  jti: string;
  roomId: string;
  callId: string;
  callType: GuestCallType;
  callMode?: GuestCallMode;
  issuedBy: string;
  createdAt: string;
  expiresAt: string;
  useCount: number;
}
