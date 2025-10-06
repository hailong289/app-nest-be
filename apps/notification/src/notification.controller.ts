import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import { Response } from '@app/helpers/response';

@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern('send_otp')
  async sendOtp(@Payload() data: { email: string; string; otp: string }) {
    await this.notificationService.sendOtp(data)
    return Response.success(null, 'OTP sent successfully');
  }
}