import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  OnModuleInit,
  Post,
  Put,
  Req,
  Param,
  Res,
  Query,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { SendOtpDto, VerifyOtpDto } from '@app/dto';
import {
  setAuthCookie,
  type AuthCookiePayload,
} from 'libs/helpers/src';

interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    [key: string]: unknown;
  };
}

interface NotificationServiceGrpc {
  PushNotificationTest(data: {
    title: string;
    message: string;
    fcmTokens: string[];
    data?: Record<string, any>;
  }): Observable<any>;
  GetNotifications(data: { userId: string }): Observable<any>;
  MarkNotificationAsRead(data: { notificationId: string }): Observable<any>;
  MarkAllNotificationsAsRead(data: { userId: string }): Observable<any>;
  DeleteNotification(data: { notificationId: string }): Observable<any>;
}

interface AuthGrpcService {
  sendOtp(data: SendOtpDto): Observable<unknown>;
  verifyOtp(data: VerifyOtpDto): Observable<unknown>;
}

const NOTIFICATION_GRPC_SERVICE = 'NOTIFICATION_GRPC_SERVICE';

@Controller('notifications')
export class GatewayNotificationController implements OnModuleInit {
  private notificationGrpc: NotificationServiceGrpc;
  private authService: AuthGrpcService;

  public constructor(
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @Inject(NOTIFICATION_GRPC_SERVICE)
    private readonly notificationGrpcClient: ClientGrpc,
    @Inject(SERVICES.AUTH)
    private readonly authClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.notificationGrpc =
      this.notificationGrpcClient.getService<NotificationServiceGrpc>(
        'NotificationService',
      );
    this.authService =
      this.authClient.getService<AuthGrpcService>('AuthService');
  }

  /**
   * Public OTP send (FE): `{ email, type }` → auth creates OTP + emails via Kafka.
   * Internal (auth-service): `{ email, otp }` → Kafka only, sends the mail.
   */
  @Post('send-otp')
  async sendOtp(
    @Body() body: { email: string; type?: string; otp?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (body.otp) {
      return await this.gatewayService.dispatchServiceEvent(
        this.notificationClient,
        'send_otp',
        {
          email: body.email,
          otp: body.otp,
          userId: req.user?._id,
        },
      );
    }

    return await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.sendOtp(data),
      {
        email: body.email,
        type: (body.type as SendOtpDto['type']) || 'register',
      },
    );
  }

  /**
   * Verify OTP against auth DB. Register → `tempRegisterToken`;
   * reset-password → `accessToken` (+ HttpOnly cookie on web).
   */
  @Post('verify-otp')
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = (await this.gatewayService.dispatchGrpcRequest(
      (data) => this.authService.verifyOtp(data),
      body,
    )) as { metadata?: { tempRegisterToken?: string; accessToken?: string } };

    if (result?.metadata?.accessToken && !result?.metadata?.tempRegisterToken) {
      setAuthCookie(res, result.metadata as AuthCookiePayload);
    }
    return result;
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string; token: string }) {
    return await this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'forgot_password',
      body,
    );
  }

  @Post('push-notification')
  async pushNotification(
    @Body()
    body: {
      title: string;
      message: string;
      fcmTokens: string[];
      data?: Record<string, unknown>;
    },
  ) {
    return await this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'push_notification',
      body,
    );
  }

  @Post('push-notification-test')
  async pushNotificationTest(
    @Body()
    body: {
      title: string;
      message: string;
      fcmTokens: string[];
      data?: Record<string, unknown>;
    },
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.PushNotificationTest.bind(this.notificationGrpc),
      body,
    );
  }

  @Get()
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const rawLimit = Number(limit);
    const rawOffset = Number(offset);
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.GetNotifications.bind(this.notificationGrpc),
      {
        userId: req.user?._id,
        limit: Math.min(
          Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
          100,
        ),
        offset:
          Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
      },
    );
  }

  @Put('read-all')
  async markAllNotificationsAsRead(@Req() req: AuthenticatedRequest) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.MarkAllNotificationsAsRead.bind(
        this.notificationGrpc,
      ),
      { userId: req.user?._id },
    );
  }

  @Put(':notificationId/read')
  async markNotificationAsRead(
    @Param('notificationId') notificationId: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.MarkNotificationAsRead.bind(this.notificationGrpc),
      { notificationId },
    );
  }

  @Delete(':notificationId')
  async deleteNotification(
    @Param('notificationId') notificationId: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.DeleteNotification.bind(this.notificationGrpc),
      { notificationId },
    );
  }
}
