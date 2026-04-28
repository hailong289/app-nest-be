import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  UpdateAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  VerifyOtpDto,
  SearchUserDto,
} from '@app/dto';

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

  @GrpcMethod('AuthService', 'Logout')
  async logout(data: { userId: string; jti: string; fcmToken?: string }) {
    return await this.authService.logout(data.userId, data.jti, data.fcmToken);
  }

  @GrpcMethod('AuthService', 'RefreshToken')
  async refreshToken(data: { userId: string; jti: string }) {
    // Support both legacy (refreshToken) and new (userId, jti) input

    return await this.authService.refreshToken(data.userId, data.jti);
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
}
