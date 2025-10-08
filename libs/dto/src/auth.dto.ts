import { IsEmpty, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  email?: string;
  phone?: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  gender?: string;
  dateOfBirth?: Date;
  type: 'email' | 'phone';
  @IsOptional()
  @IsString()
  fcmToken: string; // Thêm trường fcmToken
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
}

export class VerifyOtpDto {
  @IsNotEmpty({ message: 'Chỉ số không được để trống' })
  indicator: string;
  @IsNotEmpty({ message: 'Mã OTP không được để trống' })
  otp: string;
}
