import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Auth DTOs
export class LoginDto {
  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  username: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  @IsOptional()
  @IsString()
  fcmToken: string; // Thêm trường fcmToken
}

export class RegisterDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullname: string;
  @IsOptional()
  @IsString()
  email: string;
  @IsOptional()
  @IsString()
  phone: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  @IsNotEmpty({ message: 'Giới tính không được để trống' })
  gender: string;
  @IsNotEmpty({ message: 'Ngày sinh không được để trống' })
  dateOfBirth: Date;
  @IsNotEmpty({ message: 'Loại tài khoản không được để trống' })
  type: 'email' | 'phone';
  @IsOptional()
  @IsString()
  fcmToken: string; // Thêm trường fcmToken
  @IsOptional()
  @IsString()
  confirm: string;
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
  @IsOptional()
  @IsString()
  type: string; // Thêm type tùy chọn reset_password, verify_account
  @IsOptional()
  @IsString()
  userId: string; // Thêm userId tùy chọn
}

export class LogoutDto {
  @IsNotEmpty()
  refreshToken: string;

  @IsNotEmpty()
  userId: string;
}

export class SearchUserDto {
  @IsOptional()
  keyword: string;

  @IsOptional()
  page: number;

  @IsOptional()
  limit: number;
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
}
