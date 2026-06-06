import { REDISKEY } from '@app/constants/RedisKey';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { RedisService, Key, Notification, NotificationType } from 'libs/db/src';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationService } from './notification.service';

@Injectable()
export class FirebaseService {
  private app!: admin.app.App;
  private readonly key = REDISKEY;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    @InjectModel(Key.name) private readonly keyModel: Model<Key>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly notificationService: NotificationService,
  ) {
    if (!admin.apps.length) {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get<string>('firebase.projectId'),
          clientEmail: this.configService.get<string>('firebase.clientEmail'),
          privateKey: this.configService
            .get<string>('firebase.privateKey')
            ?.replace(/\\n/g, '\n'), // Lưu ý replace \n
        }),
        storageBucket: this.configService.get<string>('firebase.storageBucket'),
      });
    } else {
      this.app = admin.app();
    }
  }

  getAuth() {
    return admin.auth(this.app || admin.app());
  }

  getFirestore() {
    return admin.firestore(this.app || admin.app());
  }

  getStorage() {
    return admin.storage(this.app || admin.app());
  }

  getMessaging() {
    return admin.messaging(this.app || admin.app());
  }

  getApp() {
    return this.app;
  }

  async pushNotification({
    title,
    message,
    fcmTokens,
    data,
    skipSaveToDb = false,
  }: {
    title: string;
    message: string;
    fcmTokens: (string | null | undefined)[];
    data?: Record<string, any>;
    skipSaveToDb?: boolean;
  }) {
    // SANITIZE: loại token null/rỗng. CỰC KỲ QUAN TRỌNG — nếu để lọt `null`,
    // truy vấn `{ tkn_fcmToken: { $in: [null] } }` bên dưới sẽ KHỚP MỌI device
    // chưa đăng ký FCM của TOÀN BỘ user → tạo notification cho cả hệ thống
    // (bug "gửi cho toàn bộ user"). Token rỗng cũng làm FCM multicast lỗi.
    const tokens = (fcmTokens || []).filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    );
    if (tokens.length === 0) {
      console.warn('pushNotification: không có FCM token hợp lệ → bỏ qua');
      return true;
    }
    /**
     * tạo notification cho người dùng (DB chết mà lỗi không làm chết service)
     */
    // Resolve recipient userIds từ tokens — dùng để lưu DB VÀ để LOG biết FCM
    // gửi cho AI (yêu cầu quan sát). Lỗi resolve không chặn việc gửi push.
    let recipientUserIds: string[] = [];
    try {
      const keys = await this.keyModel
        .find({ tkn_fcmToken: { $in: tokens } }, { tkn_userId: 1 })
        .lean();
      recipientUserIds = [...new Set(keys.map((k) => k.tkn_userId.toString()))];
    } catch (error) {
      console.error('Không resolve được userId từ FCM token:', error);
    }

    if (!skipSaveToDb) {
      try {
        if (recipientUserIds.length === 0) {
          console.warn(
            'No users found for tokens, cannot save notification to DB',
          );
        }

        await Promise.all(
          recipientUserIds.map((uid) =>
            this.notificationService.createNotification({
              userId: uid as string,
              push_type: (data?.push_type as NotificationType) || 'other',
              title,
              message,
              metadata: data as Record<string, any>,
            }),
          ),
        );
      } catch (error) {
        console.error('Không tạo được notification:', error);
      }
    }

    const payload: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title,
        body: message,
      },
      data: data
        ? Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ]),
          )
        : {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: {
          link: this.configService.get<string>('app.url_frontend') || '',
        },
      },
    };
    try {
      const res = await this.getMessaging().sendEachForMulticast(payload);
      // LOG biết gửi cho AI: danh sách userId nhận + số device + ok/fail.
      const who = recipientUserIds.length
        ? recipientUserIds.join(', ')
        : '(không map được userId)';
      console.log(
        `🔥 FCM "${title}" → ${recipientUserIds.length} user [${who}] · ` +
          `${tokens.length} device · ok=${res.successCount} fail=${res.failureCount}`,
      );
      // Token lỗi → log + GOM token CHẾT để dọn khỏi DB (khỏi gửi lại + hết spam).
      if (res.failureCount > 0) {
        // Mã lỗi FCM cho token không còn hợp lệ (NotRegistered / not found / sai).
        const INVALID_TOKEN_CODES = new Set([
          'messaging/registration-token-not-registered',
          'messaging/invalid-registration-token',
          'messaging/invalid-argument',
          'messaging/mismatched-credential',
        ]);
        const deadTokens: string[] = [];
        res.responses.forEach((r, i) => {
          if (!r.success) {
            const code = (r.error as { code?: string })?.code;
            const msg = r.error?.message || '';
            console.warn(
              `   ✗ device[${i}] token=${tokens[i]?.slice(0, 12)}… lỗi: ${msg}`,
            );
            // Token chết: theo mã lỗi HOẶC message (phòng SDK trả message thô).
            const isDead =
              (code && INVALID_TOKEN_CODES.has(code)) ||
              /not.?registered|not.?found|invalid.?(registration|argument)/i.test(
                msg,
              );
            if (isDead && tokens[i]) deadTokens.push(tokens[i]);
          }
        });

        // Dọn token chết khỏi DB: null hoá `tkn_fcmToken` (GIỮ device/session, chỉ
        // bỏ token FCM hỏng — app mở lại sẽ đăng ký token mới). Lỗi DB không chặn.
        if (deadTokens.length) {
          try {
            const del = await this.keyModel.updateMany(
              { tkn_fcmToken: { $in: deadTokens } },
              { $set: { tkn_fcmToken: null } },
            );
            console.log(
              `   🧹 đã dọn ${deadTokens.length} FCM token chết (cập nhật ${del.modifiedCount} device)`,
            );
          } catch (e) {
            console.error('   🧹 dọn FCM token chết lỗi:', e);
          }
        }
      }
    } catch (error) {
      console.error('🔥 Firebase Cloud Messaging error:', error);
    }
    return true;
  }
  async pushNotificationForUsers({
    title,
    message,
    userIds,
    data,
    saveToDb = false,
  }: {
    title: string;
    message: string;
    userIds: string[];
    data?: Record<string, any>;
    saveToDb?: boolean;
  }) {
    // Save notification to DB for all users if requested
    if (saveToDb) {
      await Promise.all(
        userIds.map((userId) =>
          this.notificationService.createNotification({
            userId,
            push_type: (data?.push_type as NotificationType) || 'other',
            title,
            message,
            metadata: data as Record<string, any>,
          }),
        ),
      );
    }

    // get fctoken from redis, fallback to MongoDB if empty
    let fcms: string[] = [];
    const redisResults = await Promise.all(
      userIds.map(async (u) => {
        try {
          return await this.redis.sMembers(this.key.USER_FCM_TOKENS(u));
        } catch (e) {
          console.error(`Redis error for user ${u}:`, e);
          return [];
        }
      }),
    );
    fcms = redisResults.flat();
    if (fcms.length === 0) {
      // Fallback: fetch from MongoDB
      const mongoKeys = await this.keyModel
        .find({ tkn_userId: { $in: userIds } }, 'tkn_fcmToken')
        .lean();
      fcms = mongoKeys.flatMap((k) => k.tkn_fcmToken || []);
    }
    if (fcms.length > 0) {
      await this.pushNotification({
        title,
        message,
        fcmTokens: fcms,
        data,
        skipSaveToDb: true,
      });
    }
  }
}
