import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('login')
  async login(@Payload() data: any) {
    try {
      if (!data || !data.email || !data.password) {
        return { success: false, message: 'Email and password are required' };
      }
      return await this.authService.login(data);
    } catch (error) {
      console.error('Auth login error:', error);
      return { success: false, message: 'Login failed' };
    }
  }

  @MessagePattern('register')
  async register(@Payload() data: any) {
    try {
      if (!data || !data.email || !data.password || !data.name) {
        return { success: false, message: 'Email, password and name are required' };
      }
      return await this.authService.register(data);
    } catch (error) {
      console.error('Auth register error:', error);
      return { success: false, message: 'Registration failed' };
    }
  }

  @MessagePattern('validate_token')
  async validateToken(@Payload() data: any) {
    try {
      if (!data || !data.token) {
        return { valid: false, message: 'Token is required' };
      }
      return await this.authService.validateToken(data.token);
    } catch (error) {
      console.error('Auth validate token error:', error);
      return { valid: false, message: 'Token validation failed' };
    }
  }

  @MessagePattern('get_user')
  async getUser(@Payload() data: any) {
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
}