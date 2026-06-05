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
    fcmTokens: string[];
    data?: Record<string, any>;
    skipSaveToDb?: boolean;
  }) {
    /**
     * tạo notification cho người dùng (DB chết mà lỗi không làm chết service)
     */
    if (!skipSaveToDb) {
      try {
        const keys = await this.keyModel
          .find({ tkn_fcmToken: { $in: fcmTokens } }, { tkn_userId: 1 })
          .lean();

        const userIds = [...new Set(keys.map((k) => k.tkn_userId.toString()))];

        if (userIds.length === 0) {
          console.warn(
            'No users found for tokens, cannot save notification to DB',
          );
        }

        await Promise.all(
          userIds.map((uid) =>
            this.notificationService.createNotification({
              userId: uid as unknown as string,
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
      tokens: fcmTokens,
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
      await this.getMessaging().sendEachForMulticast(payload);
      console.log('🔥 Firebase Cloud Messaging sent successfully');
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
