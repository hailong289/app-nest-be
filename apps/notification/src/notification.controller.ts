import { Controller } from '@nestjs/common';
import { GrpcMethod, MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import { Response } from '@app/helpers/response';
import { FirebaseService } from './firebase.service';
import { KafkaEvent } from '@app/dto';

@Controller()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly firebaseService: FirebaseService,
  ) {}

  @MessagePattern('send_otp')
  async sendOtp(@Payload() data: { email: string; otp: string }) {
    await this.notificationService.sendOtp(data);
    return Response.success(null, 'OTP sent successfully');
  }

  @MessagePattern(KafkaEvent.FORGOT_PASSWORD)
  async forgotPassword(@Payload() data: { email: string; token: string }) {
    await this.notificationService.sendForgotPasswordEmail(data);
    return Response.success(null, 'Forgot password email sent successfully');
  }

  @MessagePattern(KafkaEvent.PUSH_NOTIFICATION)
  async pushNotification(
    @Payload()
    data: {
      title: string;
      message: string;
      fcmTokens: string[];
      data?: Record<string, any>;
    },
  ) {
    await this.firebaseService.pushNotification(data);
    return Response.success(null, 'Push notification sent successfully');
  }

  @MessagePattern(KafkaEvent.PUSH_NOTIFICATION_USERS)
  async pushNotificationForUser(
    @Payload()
    data: {
      title: string;
      message: string;
      userIds: string[];
      data?: Record<string, any>;
    },
  ) {
    await this.firebaseService.pushNotificationForUsers(data);
    return Response.success(null, 'Push notification sent successfully');
  }

  @GrpcMethod('NotificationService', 'PushNotificationTest')
  async pushNotificationTest(
    @Payload()
    data: {
      title: string;
      message: string;
      fcmTokens: string[];
      data?: Record<string, any>;
    },
  ) {
    await this.firebaseService.pushNotification(data);
    return Response.success(null, 'Gửi thông báo test thành công');
  }

  @GrpcMethod('NotificationService', 'GetNotifications')
  async getNotifications(@Payload() data: { userId: string }) {
    return await this.notificationService.getNotifications(data);
  }

  @GrpcMethod('NotificationService', 'MarkNotificationAsRead')
  async markNotificationAsRead(@Payload() data: { notificationId: string }) {
    return await this.notificationService.markNotificationAsRead(data);
  }

  @GrpcMethod('NotificationService', 'MarkAllNotificationsAsRead')
  async markAllNotificationsAsRead(@Payload() data: { userId: string }) {
    return await this.notificationService.markAllNotificationsAsRead(data);
  }
}
