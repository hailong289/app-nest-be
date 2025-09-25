import { Body, Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from '@app/dto';
import { AuthJwtGuard } from './guard/auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('login')
  async login(@Payload() data: LoginDto) {
    return await this.authService.login(data);
  }

  @MessagePattern('register')
  async register(@Payload() data: RegisterDto) {
    return await this.authService.register(data);
  }

  @UseGuards(AuthJwtGuard)
  @MessagePattern('logout')
  async logout(@Payload() data: any) {
    return await this.authService.logout(data.user._id);
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