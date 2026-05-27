import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Notification, NotificationType, Otp } from 'libs/db/src';
import { Model, Types } from 'mongoose';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { firstValueFrom } from 'rxjs';

interface AuthGrpcClient {
  GetFcmTokensByUserId(data: { userId: string }): any;
  GetUserById(data: { userId: string }): any;
}

type GrpcResponse<T = any> = { metadata?: T };

@Injectable()
export class NotificationService {
  private authGrpcClient: AuthGrpcClient;

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(Otp.name)
    private readonly otpModel: Model<Otp>,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
  ) {}

  onModuleInit() {
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');
  }

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
        `,
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
    const urlFrontend = this.configService.get<string>('app.url_frontend') || process.env.URL_FRONTEND || process.env.APP_URL_FRONTEND || 'https://app-chat-fe-service-534152738497.asia-southeast1.run.app';
    await this.mailerService.sendMail({
      to: data.email,
      subject: 'Yêu cầu đặt lại mật khẩu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333; text-align: center;">IChat - Đặt lại mật khẩu</h2>
            <p>Xin chào!</p>
            <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của mình. Vui lòng nhấp vào liên kết dưới đây để đặt lại mật khẩu:</p>
            <p style="text-align: center; margin: 20px 0;">
                <a href="${urlFrontend}/auth/forgot?token=${data.token}&type=reset_password" 
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

  async deleteNotification(data: { notificationId: string }) {
    await this.notificationModel.deleteOne({ noti_id: data.notificationId });
    return Response.success(null, 'Xóa thông báo thành công');
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

  // ── OTP management (notification is the owner of OTP model) ─────────

  async createOtp(data: { indicator: string; type: string; channel: string }) {
    try {
      const otpCode = Utils.generateOtp(6);

      await this.otpModel.create({
        indicator: data.indicator,
        otp: otpCode,
        type: data.type || 'register',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 phút
      });

      // Gửi OTP qua channel tương ứng
      if (data.channel === 'email') {
        await this.sendOtp({ email: data.indicator, otp: otpCode });
      }
      // TODO: SMS channel khi có tích hợp

      return Response.success(null, 'Tạo OTP thành công');
    } catch (error) {
      console.error('Lỗi tạo OTP:', error);
      return Response.error('Không tạo được OTP', 500, 'OTP_CREATE_FAILED');
    }
  }

  async verifyOtp(data: { indicator: string; otp: string; type: string }) {
    try {
      const keyEntry = await this.otpModel
        .findOne({ indicator: data.indicator, otp: data.otp, type: data.type })
        .exec();

      if (!keyEntry) {
        return Response.error('OTP không hợp lệ hoặc đã hết hạn', 400, 'OTP_INVALID');
      }

      // OTP hợp lệ, xóa entry sau khi sử dụng
      await this.otpModel.deleteOne({ _id: keyEntry._id }).exec();
      return Response.success({ valid: true }, 'Xác thực OTP thành công');
    } catch (error) {
      console.error('Lỗi verify OTP:', error);
      return Response.error('Lỗi xác thực OTP', 500, 'OTP_VERIFY_FAILED');
    }
  }

  /**
   * Lấy FCM tokens của user thông qua gRPC Auth service.
   * Auth là single source of truth cho FCM tokens.
   */
  async getFcmTokensFromAuth(userId: string): Promise<string[]> {
    try {
      const result = await firstValueFrom(
        this.authGrpcClient.GetFcmTokensByUserId({ userId }),
      );
      const response = result as GrpcResponse<{ tokens?: string[] }>;
      if (response?.metadata?.tokens) {
        return response.metadata.tokens;
      }
      return [];
    } catch (error) {
      console.error(`Lỗi lấy FCM tokens từ Auth cho user ${userId}:`, error);
      return [];
    }
  }
}
