import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// Auth DTOs
export class LoginDto {
  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  username: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}

export class RegisterDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullname: string;
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email?: string;
  @IsString({ message: 'Số điện thoại không hợp lệ' })
  phone?: string;
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
  gender?: string;
  dateOfBirth?: Date;
  type: 'email' | 'phone';
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
