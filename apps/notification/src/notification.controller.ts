import { Controller } from '@nestjs/common';
import { GrpcMethod, MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import { Response } from '@app/helpers/response';
import { FirebaseService } from './firebase.service';
import { KafkaEvent } from '@app/dto';

type PushNotificationUsersPayload = {
  title: string;
  message: string;
  userIds: string[];
  data?: Record<string, any>;
  saveToDb?: boolean;
};

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
      saveToDb?: boolean;
    },
  ) {
    await this.firebaseService.pushNotificationForUsers(data);
    return Response.success(null, 'Push notification sent successfully');
  }

  @MessagePattern(KafkaEvent.DOC_CREATED)
  async handleDocumentCreated(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_UPDATED)
  async handleDocumentUpdated(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_NEW_VERSION)
  async handleDocumentVersionUploaded(
    @Payload() data: PushNotificationUsersPayload,
  ) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_DELETED)
  async handleDocumentDeleted(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_RESTORED)
  async handleDocumentRestored(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_MOVED)
  async handleDocumentMoved(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.DOC_SHARED)
  async handleDocumentShared(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  // Workflow Events
  @MessagePattern(KafkaEvent.FLOW_SUBMITTED)
  async handleFlowSubmitted(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.FLOW_APPROVED)
  async handleFlowApproved(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.FLOW_REJECTED)
  async handleFlowRejected(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.FLOW_REQ_CHANGE)
  async handleFlowReqChange(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.FLOW_OVERDUE)
  async handleFlowOverdue(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  // Comment & Task Events
  @MessagePattern(KafkaEvent.CMT_ADDED)
  async handleCommentAdded(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.USER_MENTIONED)
  async handleUserMentioned(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.TASK_ASSIGNED)
  async handleTaskAssigned(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  // System & Security Events
  @MessagePattern(KafkaEvent.SYS_QUOTA_WARN)
  async handleSysQuotaWarn(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.SYS_CONVERT_FAIL)
  async handleSysConvertFail(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.SEC_LOGIN_ALERT)
  async handleSecLoginAlert(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
  }

  @MessagePattern(KafkaEvent.SEC_ACCESS_DENIED)
  async handleSecAccessDenied(@Payload() data: PushNotificationUsersPayload) {
    return this.pushNotificationForUser({ ...data, saveToDb: true });
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
  async getNotifications(
    @Payload() data: { userId: string; limit?: number; offset?: number },
  ) {
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

  @GrpcMethod('NotificationService', 'DeleteNotification')
  async deleteNotification(@Payload() data: { notificationId: string }) {
    return await this.notificationService.deleteNotification(data);
  }
}
