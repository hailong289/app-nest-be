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
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { VerifyOtpDto } from '@app/dto';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import { Request } from 'express';
import type { Observable } from 'rxjs';

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
  VerifyOtp(data: {
    indicator: string;
    otp: string;
    type: string;
  }): Observable<any>;
}

const NOTIFICATION_GRPC_SERVICE = 'NOTIFICATION_GRPC_SERVICE';

@Controller('notifications')
export class GatewayNotificationController implements OnModuleInit {
  private notificationGrpc: NotificationServiceGrpc;

  public constructor(
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @Inject(NOTIFICATION_GRPC_SERVICE)
    private readonly notificationGrpcClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.notificationGrpc =
      this.notificationGrpcClient.getService<NotificationServiceGrpc>(
        'NotificationService',
      );
  }

  @Post('send-otp')
  async sendOtp(
    @Body()
    body: {
      email: string;
      otp?: string;
      type?: string;
      is_create_opt?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'send_otp',
      {
        ...body,
        // Default true for FE register flow: create OTP then send email.
        is_create_opt: body.is_create_opt ?? true,
        type: body.type ?? 'register',
        userId: req.user?._id,
      },
    );
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.VerifyOtp.bind(this.notificationGrpc),
      body,
    );
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
  async getNotifications(@Req() req: AuthenticatedRequest) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.notificationGrpc.GetNotifications.bind(this.notificationGrpc),
      { userId: req.user?._id },
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
