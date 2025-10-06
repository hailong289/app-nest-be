import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';

@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern('send_welcome_email')
  async sendWelcomeEmail(@Payload() data: { email: string; name: string }) {
    try {
      if (!data || !data.email || !data.name) {
        return { success: false, message: 'Email and name are required' };
      }
      return await this.notificationService.sendWelcomeEmail(data);
    } catch (error) {
      console.error('Send welcome email error:', error);
      return { success: false, message: 'Send welcome email failed' };
    }
  }

  @MessagePattern('send_push_notification')
  async sendPushNotification(
    @Payload()
    data: {
      tokens: string[];
      title: string;
      body: string;
      data: Record<string, string>;
    },
  ) {
    try {
      if (!data || !data.tokens || !data.title || !data.body) {
        return {
          success: false,
          message: 'Tokens, title and body are required',
        };
      }
      return await this.notificationService.sendPushNotification(data);
    } catch (error) {
      console.error('Send push notification error:', error);
      return { success: false, message: 'Send push notification failed' };
    }
  }
}
