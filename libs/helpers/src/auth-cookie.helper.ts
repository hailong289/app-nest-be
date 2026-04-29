import type { Response } from 'express';

/**
 * Slim subset of the auth gRPC response used to set the `tokens` cookie
 * on login + register + refresh-token. Only the 3 token fields are
 * required — everything else (user info, etc.) is forwarded back to the
 * FE in the response body unchanged.
 */
export interface AuthCookiePayload {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  [key: string]: unknown;
}

/**
 * Path the `tokens` cookie is scoped to. Narrowed from `/` to `/auth`
 * so the cookie is ONLY sent on auth endpoints (login / refresh-token
 * / logout / sessions / update-password). Non-auth endpoints (/chat,
 * /messages, /social…) authenticate via the `Authorization: Bearer`
 * header instead — FE reads accessToken from the Zustand store and
 * attaches it explicitly. This shrinks the blast-radius of a stolen
 * refresh token: it can only be replayed against /auth/* and never
 * leaks via a less-defended endpoint.
 *
 * IMPORTANT: setAuthCookie + clearAuthCookie + auth.middleware all
 * read this constant — keep them in lockstep. Changing the path here
 * without updating the middleware's cookie fallback or the FE's
 * Authorization-header pipeline will silently break auth.
 */
const AUTH_COOKIE_PATH = '/auth';

/**
 * Set the `tokens` auth cookie on the response. Centralised here so
 * login + register + refresh-token use the exact same options across
 * controllers.
 *
 * - **HttpOnly**: blocks JS read → XSS-resistant. FE never touches
 *   `document.cookie`; it stores accessToken in-memory (Zustand) for
 *   Bearer-header auth and the browser auto-sends THIS cookie only
 *   to /auth/* endpoints.
 * - **sameSite: 'none'**: allows cross-site (FE on a different origin
 *   from BE — typical SaaS). Requires `secure: true` (browser rule).
 * - **path: '/auth'**: scope minimisation (see AUTH_COOKIE_PATH note).
 * - **maxAge: 1 year**: cookie itself survives browser restarts;
 *   short access-token rotation handled by application-level refresh.
 */
export function setAuthCookie(
  res: Response,
  metadata: AuthCookiePayload,
): void {
  // Cookie stores ONLY the refresh token. Access token is short-lived
  // and lives in FE memory (Zustand → localStorage) so we can attach
  // it as `Authorization: Bearer` on every request. If XSS leaks the
  // store, only the access token is exposed (TTL ~15m) — the long-
  // lived refresh token in the HttpOnly cookie stays inaccessible to
  // JavaScript and can only be replayed against /auth/refresh-token.
  const refreshToken = metadata?.refreshToken ?? null;
  if (!refreshToken) return;
  res.cookie('tokens', JSON.stringify({ refreshToken }), {
    maxAge: 60 * 60 * 24 * 365 * 1000, // 1 year (express expects ms)
    path: AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'none',
    secure: true,
  });
}

/**
 * Clear the `tokens` cookie. MUST use the same path + sameSite + secure
 * + httpOnly attributes as setAuthCookie — otherwise the browser keeps
 * the original cookie and we end up with two `tokens` cookies (one
 * cleared, one live), which is undefined cross-browser behavior.
 *
 * Called on:
 *   - explicit logout (always, even if grpc fails)
 *   - refresh-token failure (token expired/revoked → cookie is now
 *     useless, prevent FE from sending it on retry loops)
 *   - login failure (defensive: stale cookie from a previous session
 *     could confuse the FE state machine)
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie('tokens', {
    path: AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'none',
    secure: true,
  });
  // Migration: also clear the legacy `path: '/'` cookie set by the
  // previous helper version. Browsers can hold both cookies of the
  // same name simultaneously when paths differ — leaving the old one
  // alive means /chat etc. keeps sending a stale token after the user
  // logs out. Safe to remove once all clients have rotated past this
  // deploy (~1 month given 1-year cookie maxAge → drop after that).
  res.clearCookie('tokens', {
    path: '/',
    httpOnly: true,
    sameSite: 'none',
    secure: true,
  });
}
