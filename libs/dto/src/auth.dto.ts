import { IsNotEmpty } from "class-validator";

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
  email?: string;
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