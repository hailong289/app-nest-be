// Auth DTOs
export class LoginDto {
  username: string;
  password: string;
}

export class RegisterDto {
  fullname: string; 
  email?: string;
  phone?: string;
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