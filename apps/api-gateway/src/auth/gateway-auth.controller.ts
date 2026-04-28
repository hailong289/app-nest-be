import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  UpdateAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  VerifyOtpDto,
  SearchUserDto,
} from '@app/dto';
import {
  Body,
  Controller,
  Inject,
  Post,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import type { AuthenticatedRequest } from 'libs/types';

interface AuthGrpcService {
  login(data: LoginDto): any;
  register(data: RegisterDto): any;
  logout(data: { userId: string; jti: string; fcmToken?: string }): any;
  getUser(data: { userId: string }): any;
  updatePassword(data: UpdatePasswordDto & { userId: string }): any;
  verifyOtp(data: VerifyOtpDto): any;
  forgotPassword(data: ForgotPasswordDto): any;
  resetPassword(data: { userId: string; newPassword: string }): any;
  updateAvatar(data: UpdateAvatarDto & { userId: string }): any;
  updateProfile(data: UpdateProfileDto): any;
  searchUser(data: SearchUserDto): any;
  refreshToken(data: { refreshToken: string }): any;
}

@Controller('auth')
export class GatewayAuthController {
  private authService!: AuthGrpcService;

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
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.login.bind(this.authService),
      loginDto,
    );
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.register.bind(this.authService),
      registerDto,
    );
  }

  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Body() body: { fcmToken?: string },
  ) {
    // Safely extract jti from user object
    const jti: string | undefined =
      req.user && typeof req.user === 'object' && 'jti' in req.user
        ? (req.user as { jti?: string }).jti
        : undefined;

    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.logout.bind(this.authService),
      { userId: req.user?._id, jti, fcmToken: body.fcmToken },
    );
  }

  @Get('search')
  async searchUser(@Query() query: SearchUserDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.searchUser.bind(this.authService),
      query,
    );
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.verifyOtp.bind(this.authService),
      body,
    );
  }

  @Post('refresh-token')
  async refreshToken(@Req() req: AuthenticatedRequest) {
    const jti: string | undefined =
      req.user && typeof req.user === 'object' && 'jti' in req.user
        ? (req.user as { jti?: string }).jti
        : undefined;
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.refreshToken.bind(this.authService),
      { userId: req.user?._id, jti },
    );
  }

  @Post('update-password')
  async updatePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { newPassword: string; oldPassword: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.updatePassword.bind(this.authService),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.forgotPassword.bind(this.authService),
      body,
    );
  }

  @Post('reset-password')
  async resetPassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { newPassword: string },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.resetPassword.bind(this.authService),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }

  @Post('update-avatar')
  async updateAvatar(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateAvatarDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.updateAvatar.bind(this.authService),
      {
        avatarUrl: body.avatarUrl,
        userId: req.user?._id,
      },
    );
  }

  @Post('update-profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.authService.updateProfile.bind(this.authService),
      {
        ...body,
        userId: req.user?._id,
      },
    );
  }
}
