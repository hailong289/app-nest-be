import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  UpdatePasswordDto,
  VerifyOtpDto,
} from '@app/dto';
import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway.service';
import { SERVICES } from '@app/constants/services';

interface AuthGrpcService {
  login(data: LoginDto): any;
  register(data: RegisterDto): any;
  logout(data: { userId: string }): any;
  getUser(data: { userId: string }): any;
  updatePassword(data: UpdatePasswordDto & { userId: string }): any;
  verifyOtp(data: VerifyOtpDto): any;
  forgotPassword(data: ForgotPasswordDto): any;
  resetPassword(data: { username: string; newPassword: string }): any;
}

@Controller('auth')
export class GatewayAuthController {
  private authService: AuthGrpcService;

  public constructor(
    @Inject(SERVICES.AUTH) private readonly authClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.authService =
      this.authClient.getService<AuthGrpcService>('AuthService');
  }

  // Auth endpoints
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    console.log('Login DTO:', loginDto);
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.login,
      loginDto,
    );
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.register,
      registerDto,
    );
  }

  @Post('logout')
  async logout(@Req() req: any) {
    console.log('Logout request user:', req.user);
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.logout,
      { userId: req.user?.id },
    );
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.verifyOtp,
      body,
    );
  }

  @Post('update-password')
  async updatePassword(
    @Req() req: any,
    @Body() body: { newPassword: string; oldPassword: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.updatePassword,
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.forgotPassword,
      body,
    );
  }

  @Post('reset-password')
  async resetPassword(@Req() req: any, @Body() body: { newPassword: string }) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.resetPassword,
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }
}
