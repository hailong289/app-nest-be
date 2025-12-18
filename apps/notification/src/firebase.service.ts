import { REDISKEY } from '@app/constants/RedisKey';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { RedisService, Key } from 'libs/db/src';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App;
  private readonly key = REDISKEY;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    @InjectModel(Key.name) private readonly keyModel: Model<Key>,
  ) {}

  onModuleInit() {
    if (!admin.apps.length) {
      try {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: this.configService.get<string>('firebase.projectId'),
            clientEmail: this.configService.get<string>('firebase.clientEmail'),
            privateKey: this.configService.get<string>('firebase.privateKey'),
          }),
          storageBucket: this.configService.get<string>(
            'firebase.storageBucket',
          ),
        });
        console.log('🔥 Firebase initialized');
      } catch (error) {
        console.log('🔥 Firebase initialization error:', error);
      }
    } else {
      this.app = admin.app();
    }
  }

  getAuth() {
    return admin.auth(this.app);
  }

  getFirestore() {
    return admin.firestore(this.app);
  }

  getStorage() {
    return admin.storage(this.app);
  }

  getMessaging() {
    return admin.messaging(this.app);
  }

  getApp() {
    return this.app;
  }

  async pushNotification({
    title,
    message,
    fcmTokens,
    data,
  }: {
    title: string;
    message: string;
    fcmTokens: string[];
    data?: Record<string, any>;
  }) {
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
      console.log('Firebase Cloud Messaging payload:', payload);
      await this.getMessaging().sendEachForMulticast(payload);
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
  }: {
    title: string;
    message: string;
    userIds: string[];
    data?: Record<string, any>;
  }) {
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
      if (fcms.length === 0) {
        console.error('Không có fctoken (Redis & MongoDB đều trống)');
      }
    }
    if (fcms.length > 0) {
      await this.pushNotification({
        title,
        message,
        fcmTokens: fcms,
        data,
      });
    }
    console.log('đã gửi thông báo cho ', userIds);
  }
}
