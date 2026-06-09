import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  SendOtpDto,
  UpdateAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  VerifyOtpDto,
  SearchUserDto,
} from '@app/dto';
import {
  Body,
  Controller,
  Inject,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import type { AuthenticatedRequest } from 'libs/types';

/**
 * Local mirror of `DeviceContext` from libs/types/device.type. Inlined
 * because cross-lib path-alias resolution from apps/api-gateway flags
 * the imported intersection type as "error type" in some editor TS
 * servers — the runtime gRPC payload is JSON regardless, so a
 * structural copy is wire-equivalent. Keep in sync with the canonical
 * type if you add fields there.
 */
interface DeviceContext {
  ip?: string | null;
  userAgent?: string | null;
  location?: {
    country?: string;
    countryName?: string;
    region?: string;
    city?: string;
    lat?: number;
    lng?: number;
    timezone?: string;
    isp?: string;
  } | null;
}
import {
  setAuthCookie,
  clearAuthCookie,
  extractDeviceContext,
  type AuthCookiePayload,
} from 'libs/helpers/src';

interface AuthGrpcService {
  login(data: LoginDto & DeviceContext): Observable<unknown>;
  register(data: RegisterDto & DeviceContext): Observable<unknown>;
  sendOtp(data: SendOtpDto): Observable<unknown>;
  logout(data: {
    userId: string;
    // jti optional — could be missing if the access token is already
    // expired or malformed when the FE clicks logout. The auth service
    // tolerates undefined jti (just skips Redis blacklist write).
    jti?: string;
    fcmToken?: string;
    /**
     * Device identifier from the access token. Scopes the soft-revoke
     * to JUST this device's Keys row — without it, logout can't tell
     * which session ended and the row stays "active" in history.
     */
    clientId?: string;
  }): Observable<unknown>;
  listSessions(data: {
    userId: string;
    currentClientId?: string;
  }): Observable<unknown>;
  logoutDevice(data: { userId: string; clientId: string }): Observable<unknown>;
  logoutAllDevices(data: { userId: string }): Observable<unknown>;
  getUser(data: { userId: string }): Observable<unknown>;
  updatePassword(
    data: UpdatePasswordDto & { userId: string },
  ): Observable<unknown>;
  verifyOtp(data: VerifyOtpDto): Observable<unknown>;
  forgotPassword(data: ForgotPasswordDto): Observable<unknown>;
  resetPassword(data: {
    userId: string;
    newPassword: string;
  }): Observable<unknown>;
  updateAvatar(data: UpdateAvatarDto & { userId: string }): Observable<unknown>;
  updateProfile(data: UpdateProfileDto): Observable<unknown>;
  searchUser(data: SearchUserDto): Observable<unknown>;
  refreshToken(data: {
    userId: string;
    jti: string | undefined;
    clientId: string | undefined;
    ip?: string | null;
    userAgent?: string | null;
    location?: DeviceContext['location'];
  }): Observable<unknown>;
}

@Controller('auth')
export class GatewayAuthController {
  private authService!: AuthGrpcService;

  public constructor(
    @Inject(SERVICES.AUTH) private readonly authClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.authService =
      this.authClient.getService<AuthGrpcService>('AuthService');
  }

  /**
   * Set the `tokens` auth cookie on the response. Centralised so login +
   * refresh-token use the exact same options. 1-year max-age — short
   * access-token rotation is handled by the application-level refresh
   * flow, so the cookie itself can survive browser restarts.
   *
   * Cookie is **HttpOnly** for XSS resistance: a malicious script
   * injected in the FE bundle can no longer read the refresh token from
   * `document.cookie`. As a consequence, the FE can't read the cookie
   * either — auth on the Socket.IO upgrade now relies on the cookie
   * being auto-sent by the browser (`withCredentials: true`), which the
   * /chat /call /doc gateways read on `handleConnection`. REST calls
   * also rely on cookies (axios `withCredentials: true`) — no
   * Authorization header needed for first-party requests.
   */
  // setAuthCookie / clearAuthCookie / extractDeviceContext +
  // lookupLocationByIp + isPrivateOrLocalIp moved to libs/helpers/src
  // so other controllers can reuse them without copy-paste.

  // Auth endpoints
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      // Forward client ip/UA/geo so auth.service can persist them on the
      // Keys document (audit trail + suspicious-login detection).
      // Without this, Keys.tkn_ip / tkn_userAgent / tkn_location all stay
      // null after every login.
      const deviceContext: DeviceContext = extractDeviceContext(
        req,
      ) as DeviceContext;
      const result = (await this.gatewayService.dispatchGrpcRequest(
        (data) => this.authService.login(data),
        { ...loginDto, ...deviceContext },
      )) as { metadata?: AuthCookiePayload };

      // Persist tokens cookie BE-side so FE never has to call setCookie
      // manually + cookie attributes (sameSite/secure/httpOnly/maxAge)
      // stay consistent across endpoints.
      if (result?.metadata) {
        setAuthCookie(res, result.metadata);
      }
      return result;
    } catch (err) {
      // Wrong credentials / account suspended / grpc unavailable — clear
      // any stale `tokens` cookie from a previous session before the
      // error bubbles up. Without this, FE could send the stale cookie
      // on the next request and confuse the auth state machine.
      clearAuthCookie(res);
      throw err;
    }
  }

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      // Forward device-context to the auth service so the Keys model can
      // store ip/UA/location for the new account's first session. Same
      // pattern as login below.
      const deviceContext: DeviceContext = extractDeviceContext(
        req,
      ) as DeviceContext;
      const result = (await this.gatewayService.dispatchGrpcRequest(
        (data) => this.authService.register(data),
        { ...registerDto, ...deviceContext },
      )) as { metadata?: AuthCookiePayload };

      // Register implicitly logs the user in (returns access + refresh
      // tokens) — set the cookie so the FE doesn't need a separate login
      // round-trip after sign-up.
      if (result?.metadata) {
        setAuthCookie(res, result.metadata);
      }
      return result;
    } catch (err) {
      // Defensive: clear any pre-existing stale cookie. Register failure
      // shouldn't leave the FE thinking they're logged in as someone else.
      clearAuthCookie(res);
      throw err;
    }
  }

  @Post('send-otp')
  async sendOtp(@Body() body: SendOtpDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.sendOtp(data),
      body,
    );
  }

  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Body() body: { fcmToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const jti: string | undefined =
      req.user && typeof req.user === 'object' && 'jti' in req.user
        ? (req.user as { jti?: string }).jti
        : undefined;
    // clientId comes from the JWT (auth.service embedded it on login,
    // refresh preserves it). Lets auth.service soft-revoke JUST this
    // device's Keys row instead of the whole user.
    const clientId: string | undefined =
      req.user && typeof req.user === 'object' && 'clientId' in req.user
        ? (req.user as { clientId?: string }).clientId
        : undefined;

    // Always clear the cookie on logout — even if the gRPC call fails
    // (e.g. blacklist write fails), the FE-side session is gone and the
    // browser shouldn't keep sending a now-invalid token. Defense-in-
    // depth: the auth.service also adds the JTI to Redis + DB blacklist.
    clearAuthCookie(res);

    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.logout(data),
      { userId: req.user?._id, jti, fcmToken: body.fcmToken, clientId },
    );
  }

  /**
   * Resolve the authenticated user's profile. FE calls this on app
   * bootstrap (after rehydrating accessToken from localStorage) to
   * populate the in-memory user state — we deliberately do NOT persist
   * `user` to localStorage so a stale snapshot can't drift from the
   * server-of-truth (avatar/role/email changes show up on next reload).
   */
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.getUser(data),
      { userId: req.user?._id },
    );
  }

  /**
   * List the user's device sessions for the "Quản lý thiết bị" page.
   * Marks the current request's device as `isCurrent: true` so the FE
   * can disable the "logout this device" button on it (would lock the
   * UI mid-request).
   */
  @Get('sessions')
  async listSessions(@Req() req: AuthenticatedRequest) {
    const currentClientId: string | undefined =
      req.user && typeof req.user === 'object' && 'clientId' in req.user
        ? (req.user as { clientId?: string }).clientId
        : undefined;
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.listSessions(data),
      { userId: req.user?._id, currentClientId },
    );
  }

  /**
   * Revoke a specific device session (settings → "Đăng xuất thiết bị
   * này"). Caller is implicitly authorised — middleware ensured the
   * token is valid; auth.service scopes by userId + clientId so the
   * caller can only revoke their own sessions.
   */
  @Post('sessions/:clientId/revoke')
  async logoutDevice(
    @Req() req: AuthenticatedRequest,
    @Param('clientId') clientId: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.logoutDevice(data),
      { userId: req.user?._id, clientId },
    );
  }

  /**
   * Revoke EVERY device session for the user — typically chained with
   * a "change password" flow ("Đăng xuất tất cả thiết bị khác" after
   * a suspected compromise). Soft-deletes all rows so login history
   * stays intact.
   */
  @Post('sessions/revoke-all')
  async logoutAllDevices(@Req() req: AuthenticatedRequest) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.logoutAllDevices(data),
      { userId: req.user?._id },
    );
  }

  @Get('search')
  async searchUser(@Query() query: SearchUserDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.searchUser(data),
      query,
    );
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = (await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.verifyOtp(data),
      body,
    )) as { metadata?: { tempRegisterToken?: string; accessToken?: string } };

    // Reset-password OTP → accessToken + cookie. Register OTP → tempRegisterToken only.
    if (result?.metadata?.accessToken && !result?.metadata?.tempRegisterToken) {
      setAuthCookie(res, result.metadata as AuthCookiePayload);
    }
    return result;
  }

  @Post('refresh-token')
  async refreshToken(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const jti: string | undefined =
      req.user && typeof req.user === 'object' && 'jti' in req.user
        ? (req.user as { jti?: string }).jti
        : undefined;
    // clientId from the OLD refresh token. auth.service preserves it
    // when signing the new pair, so the device session keeps tracking
    // the same Keys row across rotations.
    const clientId: string | undefined =
      req.user && typeof req.user === 'object' && 'clientId' in req.user
        ? (req.user as { clientId?: string }).clientId
        : undefined;
    // Refresh = user is "active right now" → re-extract device context
    // and forward to auth.service so Keys.tkn_lastSeenAt + tkn_lastSeenIp
    // get updated. Useful for "Active sessions" UI and detecting
    // session-stealing (refresh from a wildly different country).
    const deviceContext: DeviceContext = extractDeviceContext(
      req,
    ) as DeviceContext;
    let result: { metadata?: AuthCookiePayload };
    try {
      result = (await this.gatewayService.dispatchGrpcRequest(
        (data) => this.authService.refreshToken(data),
        { userId: req.user?._id, jti, clientId, ...deviceContext },
      )) as { metadata?: AuthCookiePayload };
    } catch (err) {
      // Refresh failed — token has been revoked, expired, or tampered
      // with. Clear the cookie so the FE stops retrying and falls into
      // its login redirect path.
      clearAuthCookie(res);
      throw err;
    }

    // Refresh succeeded → rotate the cookie with the NEW token pair.
    // Browser overwrites the previous one (same path + name).
    if (result?.metadata) {
      setAuthCookie(res, result.metadata);
    }
    return result;
  }

  @Post('update-password')
  async updatePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { newPassword: string; oldPassword: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.updatePassword(data),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.forgotPassword(data),
      body,
    );
  }

  @Post('reset-password')
  async resetPassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { newPassword: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.resetPassword(data),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }

  @Post('update-avatar')
  async updateAvatar(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateAvatarDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.updateAvatar(data),
      {
        avatarUrl: body.avatarUrl,
        userId: req.user?._id,
      },
    );
  }

  @Post('update-profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.updateProfile(data),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }
}
