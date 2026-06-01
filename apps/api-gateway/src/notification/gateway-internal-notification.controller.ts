import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants/services';
import { GatewayService } from '../gateway/gateway.service';

@Controller('internal/notifications')
export class GatewayInternalNotificationController {
  constructor(
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  @Post('send-otp')
  async sendOtp(
    @Body() body: { email: string; otp: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['auth']);

    return this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'send_otp',
      {
        email: body.email,
        otp: body.otp,
      },
      5000,
    );
  }

  @Post('forgot-password')
  async forgotPassword(
    @Body() body: { email: string; token: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['auth']);

    return this.gatewayService.dispatchServiceEvent(
      this.notificationClient,
      'forgot_password',
      body,
      5000,
    );
  }

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
    allowedServices: string[] = [],
  ) {
    if (!internalService || !allowedServices.includes(internalService)) {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
