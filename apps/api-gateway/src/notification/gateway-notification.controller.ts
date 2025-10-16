import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import { SERVICES } from '@app/constants/services';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    [key: string]: unknown;
  };
}

@Controller('notifications')
export class GatewayNotificationController {
  public constructor(
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    private readonly gatewayService: GatewayService,
  ) {}

  @Post('send-otp')
  async sendOtp(
    @Body() body: { email: string; otp: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'send_otp',
      {
        ...body,
        userId: req.user?._id,
      },
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
}
