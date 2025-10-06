import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationService {
  constructor(private readonly mailerService: MailerService) { }

  async sendOtp(user: { email: string; otp: string }) {
    console.log(`Sending OTP ${user.otp} to ${user.email}`);
    try {
      await this.mailerService.sendMail({
        to: user.email,
        subject: 'Mã OTP của bạn',
        template: './otp',
        context: {
          otp: user.otp,
        }
      });
    } catch (error) {
      console.error(`Error sending OTP to ${user.email}:`, error);
    }
    return { success: true, message: 'OTP sent successfully' };
  }
}