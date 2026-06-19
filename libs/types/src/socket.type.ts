import type { Socket } from 'socket.io';

/**
 * JWT payload shape produced by the auth service. Shared by every gateway
 * (`/chat`, `/call`, `/doc`) that authenticates clients against the same
 * access token, so they all read the same fields the same way.
 *
 * Field naming follows the auth service convention: `usr_*` prefix for
 * business attributes, `_id` for the Mongo ObjectId. The `[key: string]: any`
 * escape hatch covers extra fields (custom claims, future additions) that
 * individual gateways may opt into without touching this type.
 */
export interface JwtPayload {
  _id: string; // MongoDB _id (24-char hex)
  usr_fullname: string;
  usr_email: string;
  usr_phone?: string;
  usr_avatar?: string;
  usr_gender?: string;
  usr_status?: string;
  usr_id: string; // ULID — the FE-facing user identifier
  usr_slug: string;
  usr_dateOfBirth?: string;
  createdAt?: string;
  updatedAt?: string;
  jti: string;
  [key: string]: any;
}

/**
 * Socket.IO socket augmented with the resolved user payload. `userId` is the
 * Mongo `_id` (used for relational joins, room keys, etc.); `user` holds the
 * full JWT payload (used for FE-facing IDs and presence broadcasts).
 *
 * Both fields are optional because they're only populated AFTER successful
 * auth in `handleConnection`; pre-auth code paths must guard accordingly.
 */
export interface SocketWithUser extends Socket {
  userId?: string; // MongoDB _id
  user?: JwtPayload;
}
