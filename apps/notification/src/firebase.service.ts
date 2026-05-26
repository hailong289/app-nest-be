import { REDISKEY } from '@app/constants/RedisKey';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { RedisService, Notification, NotificationType } from 'libs/db/src';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationService } from './notification.service';
import { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { firstValueFrom } from 'rxjs';

interface AuthGrpcClient {
  GetFcmTokensByUserId(data: { userId: string }): any;
}

@Injectable()
export class FirebaseService {
  private app!: admin.app.App;
  private readonly key = REDISKEY;
  private authGrpcClient: AuthGrpcClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly notificationService: NotificationService,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
  ) {
    if (!admin.apps.length) {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get<string>('firebase.projectId'),
          clientEmail: this.configService.get<string>('firebase.clientEmail'),
          privateKey: this.configService
            .get<string>('firebase.privateKey')
            ?.replace(/\\n/g, '\n'),
        }),
        storageBucket: this.configService.get<string>('firebase.storageBucket'),
      });
    } else {
      this.app = admin.app();
    }
  }

  onModuleInit() {
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');
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

  /**
   * Lấy FCM tokens của user thông qua gRPC Auth service.
   * Auth là single source of truth cho FCM tokens.
   * Fallback: Redis → gRPC Auth.
   */
  private async getFcmTokensForUser(userId: string): Promise<string[]> {
    // Primary: Redis
    try {
      const redisTokens = await this.redis.sMembers(
        this.key.USER_FCM_TOKENS(userId),
      );
      if (redisTokens.length > 0) return redisTokens;
    } catch (e) {
      console.error(`Redis error for user ${userId}:`, e);
    }

    // Fallback: Auth service qua gRPC
    try {
      const result = await firstValueFrom(
        this.authGrpcClient.GetFcmTokensByUserId({ userId }),
      );
      if (result?.metadata?.tokens?.length > 0) {
        return result.metadata.tokens;
      }
    } catch (error) {
      console.error(`Error fetching FCM tokens from Auth for user ${userId}:`, error);
    }

    return [];
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
     * Tạo notification cho người dùng (DB chết mà lỗi không làm chết service).
     * Lấy userIds từ FCM tokens thông qua gRPC Auth service.
     */
    if (!skipSaveToDb && fcmTokens.length > 0) {
      try {
        // Với token-based push, ta không thể dễ dàng map tokens → userIds
        // mà không có DB. Tạm thời ta vẫn lưu notification nhưng bỏ qua
        // việc map nếu không có userIds từ caller.
        // Caller có thể truyền userIds qua data nếu cần.
        console.warn(
          'Token-based push: skipping DB save (no userId mapping). Use user-based push (PushNotificationForUsers) for DB notifications.',
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

    // Get FCM tokens per user: Redis primary, Auth gRPC fallback
    const tokenResults = await Promise.all(
      userIds.map(async (userId) => {
        const tokens = await this.getFcmTokensForUser(userId);
        return tokens;
      }),
    );
    const fcms = tokenResults.flat();

    if (fcms.length === 0) {
      console.error('Không có fctoken (Redis & Auth gRPC đều trống)');
      return false;
    }

    return this.pushNotification({
      title,
      message,
      fcmTokens: fcms,
      data,
      skipSaveToDb: true, // Đã lưu ở trên
    });
  }
}
