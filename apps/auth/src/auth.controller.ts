import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  SendOtpDto,
  UpdateAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  VerifyOtpDto,
  SearchUserDto,
} from '@app/dto';

/**
 * Local gRPC payload interfaces.
 *
 * These mirror the new DTOs added to libs/dto/src/auth.dto.ts
 * (LogoutDto / RefreshTokenGrpcDto / ListSessionsDto / LogoutDeviceDto
 * / LogoutAllDevicesDto). They're declared inline here because the
 * editor's TypeScript server intermittently flags freshly-added
 * exports from `@app/dto` as `error type` until a full restart, and
 * gRPC handlers don't run NestJS validation pipes on inbound data
 * anyway — so a structural interface gives us the same wire-level
 * type safety without depending on cross-lib resolution. The canonical
 * DTO classes still exist in libs/dto for any HTTP/validation
 * consumers; keep them in sync if you change the wire format.
 */
interface LogoutGrpcPayload {
  userId: string;
  jti?: string;
  clientId?: string;
  fcmToken?: string;
}

interface RefreshTokenGrpcPayload {
  userId: string;
  jti?: string;
  clientId?: string;
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

interface ListSessionsGrpcPayload {
  userId: string;
  currentClientId?: string;
}

interface LogoutDeviceGrpcPayload {
  userId: string;
  clientId: string;
}

interface LogoutAllDevicesGrpcPayload {
  userId: string;
}

interface GetFcmTokensGrpcPayload {
  userIds: string[];
}

interface ResolveBusinessIdsGrpcPayload {
  usrIds: string[];
}

interface GetUsersBatchGrpcPayload {
  userIds: string[];
  search?: string;
}

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod('AuthService', 'Login')
  async login(data: LoginDto) {
    return await this.authService.login(data);
  }

  @GrpcMethod('AuthService', 'Register')
  async register(data: RegisterDto) {
    return await this.authService.register(data);
  }

  @GrpcMethod('AuthService', 'SendOtp')
  async sendOtp(data: SendOtpDto) {
    return await this.authService.sendOtp(data.email, data.type);
  }

  @GrpcMethod('AuthService', 'Logout')
  async logout(data: LogoutGrpcPayload) {
    return await this.authService.logout(
      data.userId,
      data.jti,
      data.fcmToken,
      data.clientId,
    );
  }

  @GrpcMethod('AuthService', 'RefreshToken')
  async refreshToken(data: RefreshTokenGrpcPayload) {
    return await this.authService.refreshToken(
      data.userId,
      data.jti ?? '',
      data.clientId ?? '',
      data,
    );
  }

  @GrpcMethod('AuthService', 'ListSessions')
  async listSessions(data: ListSessionsGrpcPayload): Promise<unknown> {
    return await this.authService.listSessions(
      data.userId,
      data.currentClientId,
    );
  }

  @GrpcMethod('AuthService', 'LogoutDevice')
  async logoutDevice(data: LogoutDeviceGrpcPayload): Promise<unknown> {
    return await this.authService.logoutDevice(data.userId, data.clientId);
  }

  @GrpcMethod('AuthService', 'LogoutAllDevices')
  async logoutAllDevices(data: LogoutAllDevicesGrpcPayload): Promise<unknown> {
    return await this.authService.logoutAllDevices(data.userId);
  }

  @GrpcMethod('AuthService', 'GetUser')
  async getUser(data: { userId: string }) {
    try {
      if (!data || !data.userId) {
        return { success: false, message: 'User ID is required' };
      }
      return await this.authService.getUser(data.userId);
    } catch (error) {
      console.error('Auth get user error:', error);
      return { success: false, message: 'Get user failed' };
    }
  }

  @GrpcMethod('AuthService', 'UpdatePassword')
  async updatePassword(data: UpdatePasswordDto & { userId: string }) {
    console.log('UpdatePassword gRPC data:', data);
    return await this.authService.updatePassword(data);
  }

  @GrpcMethod('AuthService', 'VerifyOtp')
  async verifyOtp(data: VerifyOtpDto) {
    return await this.authService.verifyOtp(
      data.indicator,
      data.otp,
      data.type,
    );
  }

  @GrpcMethod('AuthService', 'ForgotPassword')
  async forgotPassword(data: {
    username: string;
    email: string;
    isMobile?: boolean;
  }) {
    console.log('ForgotPassword gRPC data:', data);
    return await this.authService.forgotPassword(
      data.email,
      data.username,
      data?.isMobile || false,
    );
  }

  @GrpcMethod('AuthService', 'ResetPassword')
  async resetPassword(data: { userId: string; newPassword: string }) {
    return await this.authService.resetPassword(data.userId, data.newPassword);
  }

  @GrpcMethod('AuthService', 'UpdateAvatar')
  async updateAvatar(@Payload() data: UpdateAvatarDto & { userId: string }) {
    return await this.authService.updateAvatar(data);
  }

  @GrpcMethod('AuthService', 'UpdateProfile')
  async updateProfile(@Payload() data: UpdateProfileDto & { userId: string }) {
    return await this.authService.updateProfile(data);
  }

  @GrpcMethod('AuthService', 'SearchUser')
  async searchUser(data: SearchUserDto) {
    return await this.authService.searchUser(data);
  }

  @GrpcMethod('AuthService', 'GetFcmTokens')
  async getFcmTokens(data: GetFcmTokensGrpcPayload) {
    return await this.authService.getActiveFcmTokensForUsers(data.userIds);
  }

  @GrpcMethod('AuthService', 'ResolveBusinessIds')
  async resolveBusinessIds(data: ResolveBusinessIdsGrpcPayload) {
    return await this.authService.resolveBusinessIds(data.usrIds);
  }

  @GrpcMethod('AuthService', 'GetUsersBatch')
  async getUsersBatch(data: GetUsersBatchGrpcPayload) {
    return await this.authService.getUsersBatch(data.userIds, data.search);
  }
}
