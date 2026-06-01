import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Device-origin geolocation, populated by api-gateway via geoip-lite
 * before forwarding to auth-service over gRPC. All fields optional —
 * lookups fail for private IPs / unmapped ranges.
 */
export class DeviceLocationDto {
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() countryName?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() lat?: number;
  @IsOptional() lng?: number;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() isp?: string;
}

/**
 * Parsed User-Agent. Populated by `parseUserAgent` (ua-parser-js) in
 * libs/helpers/src/device-context.helper before forwarding to
 * auth-service over gRPC. Mirrors the Mongoose `TknDeviceInfo` class
 * but without decorators so it can travel through DTO pipelines.
 */
export class DeviceInfoDto {
  @IsOptional() @IsString() browser?: string;
  @IsOptional() @IsString() browserVersion?: string;
  @IsOptional() @IsString() os?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsString() deviceType?: string;
  @IsOptional() @IsString() deviceVendor?: string;
  @IsOptional() @IsString() deviceModel?: string;
}

// Auth DTOs
export class LoginDto {
  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  username: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  @IsOptional()
  @IsString()
  fcmToken: string;

  // Device-origin context — set by api-gateway from request headers +
  // geoip-lite, NOT by the FE. Validation pipe ignores them on the
  // public /auth/login endpoint (FE never sets them); auth-service
  // reads them off the gRPC payload to populate Keys.tkn_*.
  @IsOptional()
  @IsString()
  ip?: string | null;

  @IsOptional()
  @IsString()
  userAgent?: string | null;

  @IsOptional()
  @IsObject()
  location?: DeviceLocationDto | null;

  @IsOptional()
  @IsObject()
  deviceInfo?: DeviceInfoDto | null;
}

export class RegisterDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullname: string;
  @IsNotEmpty({ message: 'Token đăng ký không được để trống' })
  @IsString()
  tempRegisterToken: string;
  @IsOptional()
  @IsString()
  email?: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  @IsNotEmpty({ message: 'Giới tính không được để trống' })
  gender: string;
  @IsNotEmpty({ message: 'Ngày sinh không được để trống' })
  dateOfBirth: Date;
  @IsOptional()
  @IsString()
  fcmToken: string;

  // Same gateway-populated device fields as LoginDto.
  @IsOptional()
  @IsString()
  ip?: string | null;

  @IsOptional()
  @IsString()
  userAgent?: string | null;

  @IsOptional()
  @IsObject()
  location?: DeviceLocationDto | null;

  @IsOptional()
  @IsObject()
  deviceInfo?: DeviceInfoDto | null;
}

export class SendOtpDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsString()
  email: string;
  @IsNotEmpty({ message: 'Loại OTP không được để trống' })
  @IsString()
  type: 'register' | 'reset-password';
}

/**
 * gRPC-only payload for the RefreshToken RPC. Built by api-gateway
 * from `req.user` + extracted device context. Not exposed via HTTP —
 * the FE just hits POST /auth/refresh-token with no body and the
 * gateway handler populates this shape before forwarding.
 */
export class RefreshTokenGrpcDto {
  @IsNotEmpty({ message: 'userId không được để trống' })
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  jti?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  ip?: string | null;

  @IsOptional()
  @IsString()
  userAgent?: string | null;

  @IsOptional()
  @IsObject()
  location?: DeviceLocationDto | null;

  @IsOptional()
  @IsObject()
  deviceInfo?: DeviceInfoDto | null;
}

export class AuthResponseDto {
  success: boolean;
  token?: string;
  user?: {
    id: number;
    email: string;
    name: string;
  };
  message?: string;
}

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'Refresh token không được để trống' })
  refreshToken: string;
}

export class UpdatePasswordDto {
  @IsNotEmpty({ message: 'Mật khẩu cũ không được để trống' })
  oldPassword: string;
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  newPassword: string;
  @IsNotEmpty({ message: 'Tài khoản không tồn tại' })
  userId: string;
}

export class ForgotPasswordDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;
  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  username: string;
  @IsOptional()
  isMobile: boolean; // Thêm trường isMobile tùy chọn
}

export class VerifyOtpDto {
  @IsNotEmpty({ message: 'Chỉ số không được để trống' })
  indicator: string;
  @IsNotEmpty({ message: 'Mã OTP không được để trống' })
  otp: string;
  @IsNotEmpty({ message: 'Loại OTP không được để trống' })
  @IsString()
  type: 'register' | 'reset-password';
  @IsOptional()
  @IsString()
  userId: string;
}

/**
 * gRPC payload for the Logout RPC. Built by api-gateway from
 * `req.user` (decoded access JWT) + the request body's `fcmToken`.
 * The auth-service uses jti for Redis blacklist + clientId to scope
 * the soft-revoke to a single device row in Keys.
 */
export class LogoutDto {
  @IsNotEmpty({ message: 'userId không được để trống' })
  @IsString()
  userId: string;

  /**
   * jti from the access token. Optional because a malformed/expired
   * token at logout time may have lost it — auth.service tolerates
   * undefined and just skips the Redis blacklist write.
   */
  @IsOptional()
  @IsString()
  jti?: string;

  /**
   * clientId from the access token. Without it, auth.service can't
   * tell which device session ended → can't soft-revoke the right
   * Keys row. Older callers may omit it; auth.service falls back to
   * a user-wide blacklist write in that case.
   */
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}

export class SearchUserDto {
  @IsOptional()
  keyword: string;

  @IsOptional()
  page: number;

  @IsOptional()
  limit: number;

  @IsOptional()
  excludeUsrId?: string;

  @IsOptional()
  excludeUserIds?: string[];
}

export class GetUsersBatchDto {
  @IsOptional()
  userIds: string[];

  @IsOptional()
  search?: string;
}

export class ResolveUsersByBusinessIdsDto {
  @IsOptional()
  usrIds: string[];
}

export class GetFcmTokensByUsersDto {
  @IsOptional()
  userIds: string[];
}

export interface UserSummaryDto {
  _id: string;
  userId: string;
  usr_id: string;
  id: string;
  name?: string;
  fullname: string;
  email?: string;
  phone?: string;
  avatar?: string;
  gender?: string;
  dateOfBirth?: string;
  address?: string;
  status?: string;
  slug?: string;
}

// Type cho User data sau khi loại bỏ sensitive fields
export interface UserTokenPayload {
  _id: string;
  usr_id: string;
  usr_slug: string;
  usr_fullname: string;
  usr_email: string;
  usr_phone: string;
  usr_avatar: string;
  usr_dateOfBirth: Date;
  usr_gender: string;
  usr_status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class UpdateAvatarDto {
  @IsNotEmpty({ message: 'Ảnh đại diện không được để trống' })
  @IsString()
  avatarUrl: string;
}

export class UpdateProfileDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString()
  fullname: string;

  @IsNotEmpty({ message: 'Giới tính không được để trống' })
  @IsString()
  gender: string;

  @IsNotEmpty({ message: 'Ngày sinh không được để trống' })
  @IsString()
  dateOfBirth: string;

  @IsOptional()
  @IsString()
  address?: string;
}

// ── Device-session management DTOs ──────────────────────────────────
// gRPC-payload shape only — no HTTP validation pipe runs on these
// because the gateway has already vetted the caller via AuthMiddleware.
// Using DTO classes (vs. inline object literals) keeps the type
// declaration in one place + plays nicely with NestJS metadata
// reflection.

export class ListSessionsDto {
  @IsNotEmpty({ message: 'userId không được để trống' })
  @IsString()
  userId: string;

  /**
   * clientId of the requesting browser. Lets auth.service tag the
   * caller's session as `isCurrent: true` so the FE can disable the
   * "logout this device" button on it (suicide → stuck UI).
   */
  @IsOptional()
  @IsString()
  currentClientId?: string;
}

export class LogoutDeviceDto {
  @IsNotEmpty({ message: 'userId không được để trống' })
  @IsString()
  userId: string;

  @IsNotEmpty({ message: 'clientId không được để trống' })
  @IsString()
  clientId: string;
}

export class LogoutAllDevicesDto {
  @IsNotEmpty({ message: 'userId không được để trống' })
  @IsString()
  userId: string;
}
