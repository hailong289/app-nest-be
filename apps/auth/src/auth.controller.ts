import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from '@app/dto';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService
  ) {}

  @GrpcMethod('AuthService', 'Login')
  async login(data: LoginDto) {
    return await this.authService.login(data);
  }

  @GrpcMethod('AuthService', 'Register')
  async register(data: RegisterDto) {
    return await this.authService.register(data);
  }

  @GrpcMethod('AuthService', 'Logout')
  async logout(data: { userId: string }) {
    console.log('Logout gRPC data:', data);
    return await this.authService.logout(data.userId);
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
  async updatePassword(data: { oldPassword: string; newPassword: string; userId: string }) {
    return await this.authService.updatePassword(data.oldPassword, data.newPassword, data.userId);
  }

  @GrpcMethod('AuthService', 'VerifyOtp')
  async verifyOtp(data: { indicator: string; otp: string }) {
    return await this.authService.verifyOtp(data.indicator, data.otp);
  }
}