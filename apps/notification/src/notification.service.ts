import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Notification, NotificationType } from 'libs/db/src';
import { Model, Types } from 'mongoose';

@Injectable()
export class NotificationService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  async sendOtp(user: { email: string; otp: string }) {
    console.log(`Sending OTP ${user.otp} to ${user.email}`);
    try {
      await this.mailerService.sendMail({
        to: user.email,
        subject: 'Mã OTP của bạn',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333; text-align: center;">IChat - Mã OTP</h2>
            <p>Xin chào!</p>
            <p>Bạn đã yêu cầu mã OTP để xác thực tài khoản. Vui lòng sử dụng mã dưới đây:</p>
            <div style="text-align: center; margin: 20px 0;">
                <span
                    style="font-size: 32px; font-weight: bold; color: #51BEA1; background: #f8f9fa; padding: 15px 30px; border-radius: 8px; letter-spacing: 3px;">${user.otp}</span>
            </div>
            <p><strong>Lưu ý:</strong> Mã OTP này có hiệu lực trong vòng 5 phút.</p>
            <p>Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="text-align: center; color: #999; font-size: 12px;">© 2025 IChat. All rights reserved.</p>
        </div>
        `, // Fallback nếu template không hoạt động
        context: {
          otp: user.otp,
        },
      });
    } catch (error) {
      console.error(`Error sending OTP to ${user.email}:`, error);
    }
    return { success: true, message: 'OTP sent successfully' };
  }

  async sendForgotPasswordEmail(data: { email: string; token: string }) {
    await this.mailerService.sendMail({
      to: data.email,
      subject: 'Yêu cầu đặt lại mật khẩu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333; text-align: center;">IChat - Đặt lại mật khẩu</h2>
            <p>Xin chào!</p>
            <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của mình. Vui lòng nhấp vào liên kết dưới đây để đặt lại mật khẩu:</p>
            <p style="text-align: center; margin: 20px 0;">
                <a href="${this.configService.get<string>('app.url_frontend')}/auth/forgot?token=${data.token}&type=reset_password" 
                   style="display: inline-block; padding: 10px 20px; background-color: #51BEA1; color: #fff; text-decoration: none; border-radius: 5px;">
                    Đặt lại mật khẩu
                </a>
            </p>
        </div>
      `,
    });
  }

  async createNotification(data: {
    userId: string;
    push_type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, any>;
  }) {
    try {
      await this.notificationModel.create({
        noti_userId: Utils.convertToObjectIdMongoose(data.userId),
        noti_type: data.push_type,
        noti_title: data.title,
        noti_content: data.message,
        noti_metadata: data.metadata,
      });
      return Response.success(null, 'Tạo thông báo thành công');
    } catch (error) {
      console.error('Không tạo được notification:', error);
      return Response.error('Không tạo được notification', 400, 'BAD_REQUEST');
    }
  }

  async markAllNotificationsAsRead(data: { userId: string }) {
    await this.notificationModel.updateMany(
      { noti_userId: new Types.ObjectId(data.userId) },
      { noti_read: true },
    );
    return Response.success(
      null,
      'Đánh dấu tất cả thông báo đã đọc thành công',
    );
  }

  async markNotificationAsRead(data: { notificationId: string }) {
    await this.notificationModel.updateOne(
      { noti_id: data.notificationId },
      { noti_read: true },
    );
    return Response.success(null, 'Đánh dấu thông báo đã đọc thành công');
  }

  async getNotifications(data: { userId: string }) {
    const notifications = await this.notificationModel
      .find({ noti_userId: Utils.convertToObjectIdMongoose(data.userId) })
      .sort({ createdAt: -1 });

    const toTimestamp = (date?: Date | null) => {
      if (!date) return undefined;
      const ms = date.getTime();
      return {
        seconds: Math.floor(ms / 1000),
        nanos: (ms % 1000) * 1_000_000,
      };
    };

    const payload = notifications.map((notification) => {
      const plain = notification.toObject();
      return {
        ...plain,
        createdAt: toTimestamp(notification.createdAt),
        updatedAt: toTimestamp(notification.updatedAt),
        noti_readAt: toTimestamp(notification.noti_readAt),
      };
    });

    return Response.success(
      { notifications: payload },
      'Lấy thông báo thành công',
    );
  }
}
