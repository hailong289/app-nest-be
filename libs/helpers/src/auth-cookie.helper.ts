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
 * Path the `tokens` cookie is scoped to. The gateway runs with
 * `setGlobalPrefix('api')`, so auth endpoints are served at
 * `/api/auth/...` — NOT `/auth/...`. The cookie path must match the
 * URL the browser is actually fetching, otherwise browsers won't
 * attach the cookie and the middleware never sees it (resulting in
 * 401 → clearAuthCookie loop on every refresh attempt, which is
 * exactly the symptom we hit before this fix).
 *
 * Scope is still narrow: only auth endpoints get the cookie. Non-auth
 * endpoints (/api/chat, /api/messages, /api/social…) authenticate via
 * the `Authorization: Bearer` header instead — FE reads accessToken
 * from the Zustand store and attaches it explicitly. This shrinks the
 * blast-radius of a stolen refresh token: it can only be replayed
 * against /api/auth/* and never leaks via a less-defended endpoint.
 *
 * IMPORTANT: setAuthCookie + clearAuthCookie + auth.middleware all
 * read this constant — keep them in lockstep. Changing the path here
 * without updating the middleware's cookie fallback or the FE's
 * Authorization-header pipeline will silently break auth.
 */
const AUTH_COOKIE_PATH = '/api/auth';

/**
 * Cookie security profile. Production servers run on HTTPS so we can
 * (and must, for cross-origin SaaS deployments) set `sameSite: 'none'`
 * + `secure: true`. Local dev runs on `http://localhost:*` where:
 *   - Some browsers (notably Firefox) silently REJECT cookies with
 *     `secure: true` over HTTP, so the login set-cookie is dropped
 *     and the user appears to never persist a session.
 *   - `sameSite: 'none'` requires `secure: true` per spec — using
 *     them together in dev leaves you with no cookie at all.
 * Switch to `sameSite: 'lax'` + `secure: false` in dev so cookies
 * actually get stored. FE on :3000 → BE on :5000 is same-site
 * (both `localhost`), so `lax` is sufficient.
 */
function cookieSecurityOpts() {
  const isProd = process.env.NODE_ENV === 'production';
  return isProd
    ? { sameSite: 'none' as const, secure: true }
    : { sameSite: 'lax' as const, secure: false };
}

/**
 * Set the `tokens` auth cookie on the response. Centralised here so
 * login + register + refresh-token use the exact same options across
 * controllers.
 *
 * - **HttpOnly**: blocks JS read → XSS-resistant. FE never touches
 *   `document.cookie`; it stores accessToken in-memory (Zustand) for
 *   Bearer-header auth and the browser auto-sends THIS cookie only
 *   to /api/auth/* endpoints.
 * - **sameSite/secure**: env-aware (see `cookieSecurityOpts`).
 * - **path: '/api/auth'**: scope minimisation (see AUTH_COOKIE_PATH).
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
  // JavaScript and can only be replayed against /api/auth/refresh-token.
  const refreshToken = metadata?.refreshToken ?? null;
  if (!refreshToken) return;
  res.cookie('tokens', JSON.stringify({ refreshToken }), {
    maxAge: 60 * 60 * 24 * 365 * 1000, // 1 year (express expects ms)
    path: AUTH_COOKIE_PATH,
    httpOnly: true,
    ...cookieSecurityOpts(),
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
  // Use the same security profile as setAuthCookie so the browser
  // matches the original cookie and actually deletes it. Mismatched
  // attributes leave the original alive alongside a phantom expired
  // entry — the symptom we hit with the prod-only secure flag.
  res.clearCookie('tokens', {
    path: AUTH_COOKIE_PATH,
    httpOnly: true,
    ...cookieSecurityOpts(),
  });
}
