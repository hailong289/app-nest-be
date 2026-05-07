/**
 * Re-export from `libs/types` so existing imports
 * (`from '../ws/socket-user.types'`) keep working without churning every
 * caller. Canonical source lives at `libs/types/socket.type.ts` so
 * `libs/sfu/` and other libs can also use it without cross-app imports.
 */
export type { JwtPayload, SocketWithUser } from 'libs/types';
