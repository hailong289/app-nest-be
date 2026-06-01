import { REDISKEY } from '@app/constants/RedisKey';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { RedisService, NotificationType } from 'libs/db/src';
import { Types } from 'mongoose';
import { NotificationService } from './notification.service';
import { GatewayClientService } from './gateway-client.service';

type TokenUserMap = Map<string, Set<string>>;

@Injectable()
export class FirebaseService {
  private app!: admin.app.App;
  private readonly key = REDISKEY;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly gatewayClient: GatewayClientService,
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

  private normalizeUserIds(userIds: string[] = []): string[] {
    const unique = Array.from(
      new Set(
        userIds
          .filter((userId): userId is string => typeof userId === 'string')
          .map((userId) => userId.trim())
          .filter(Boolean),
      ),
    );

    const invalid = unique.filter((userId) => !Types.ObjectId.isValid(userId));
    if (invalid.length > 0) {
      console.warn(
        `Ignored non-Mongo notification userIds: ${invalid.join(', ')}`,
      );
    }

    return unique.filter((userId) => Types.ObjectId.isValid(userId));
  }

  private addTokenMapping(
    tokenUserMap: TokenUserMap,
    token: string,
    userId: string,
  ) {
    if (!tokenUserMap.has(token)) {
      tokenUserMap.set(token, new Set());
    }
    tokenUserMap.get(token)?.add(userId);
  }

  private async resolveFcmTokensForUsers(userIds: string[]): Promise<{
    fcmTokens: string[];
    tokenUserMap: TokenUserMap;
  }> {
    const normalizedUserIds = this.normalizeUserIds(userIds);
    const tokenUserMap: TokenUserMap = new Map();
    const missUserIds: string[] = [];
    const tokenSet = new Set<string>();

    await Promise.all(
      normalizedUserIds.map(async (userId) => {
        const tokens = await this.redis.sMembers(
          this.key.USER_FCM_TOKENS(userId),
        );

        const cleanTokens = tokens.filter(Boolean);
        if (cleanTokens.length === 0) {
          missUserIds.push(userId);
          return;
        }

        for (const token of cleanTokens) {
          tokenSet.add(token);
          this.addTokenMapping(tokenUserMap, token, userId);
        }
      }),
    );

    if (missUserIds.length > 0) {
      const items = await this.gatewayClient.getFcmTokensForUsers(missUserIds);

      for (const item of items) {
        const userId = item.userId;
        const tokens = Array.from(new Set(item.fcmTokens || [])).filter(
          Boolean,
        );

        if (tokens.length === 0) {
          console.warn(`No active FCM tokens for user ${userId}`);
          continue;
        }

        await this.redis.sAdd(this.key.USER_FCM_TOKENS(userId), ...tokens);
        for (const token of tokens) {
          tokenSet.add(token);
          this.addTokenMapping(tokenUserMap, token, userId);
        }
      }
    }

    return { fcmTokens: Array.from(tokenSet), tokenUserMap };
  }

  private async removeInvalidTokens(
    batchResponse: admin.messaging.BatchResponse,
    tokens: string[],
    tokenUserMap?: TokenUserMap,
  ) {
    const invalidCodes = new Set([
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ]);

    await Promise.all(
      batchResponse.responses.map(async (response, index) => {
        const token = tokens[index];
        const code = response.error?.code;
        if (!token || !code || !invalidCodes.has(code)) return;

        const userIds = tokenUserMap?.get(token);
        if (!userIds || userIds.size === 0) return;

        await Promise.all(
          Array.from(userIds).map((userId) =>
            this.redis.sRem(this.key.USER_FCM_TOKENS(userId), token),
          ),
        );
      }),
    );
  }

  private async sendMulticast(
    title: string,
    message: string,
    fcmTokens: string[],
    data?: Record<string, any>,
    tokenUserMap?: TokenUserMap,
  ) {
    const tokens = Array.from(new Set(fcmTokens.filter(Boolean)));
    if (tokens.length === 0) {
      console.warn('Không có FCM token để gửi notification');
      return false;
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
      const response = await this.getMessaging().sendEachForMulticast(payload);
      await this.removeInvalidTokens(response, tokens, tokenUserMap);
      console.log('🔥 Firebase Cloud Messaging sent successfully');
    } catch (error) {
      console.error('🔥 Firebase Cloud Messaging error:', error);
    }
    return true;
  }

  async pushNotification({
    title,
    message,
    fcmTokens,
    userIds,
    data,
    skipSaveToDb = false,
  }: {
    title: string;
    message: string;
    fcmTokens: string[];
    userIds?: string[];
    data?: Record<string, any>;
    skipSaveToDb?: boolean;
  }) {
    /**
     * tạo notification cho người dùng (DB chết mà lỗi không làm chết service)
     */
    if (!skipSaveToDb) {
      try {
        const notificationUserIds = this.normalizeUserIds(userIds);
        if (notificationUserIds.length === 0) {
          console.warn(
            'Raw push has no Mongo userIds; skipping in-app notification save',
          );
        }

        await Promise.all(
          notificationUserIds.map((uid) =>
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

    return this.sendMulticast(title, message, fcmTokens, data);
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
    const normalizedUserIds = this.normalizeUserIds(userIds);

    // Save notification to DB for all users if requested
    if (saveToDb) {
      await Promise.all(
        normalizedUserIds.map((userId) =>
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

    const { fcmTokens, tokenUserMap } =
      await this.resolveFcmTokensForUsers(normalizedUserIds);

    if (fcmTokens.length === 0) {
      console.warn('Không có FCM token cho danh sách userIds');
      return;
    }

    await this.sendMulticast(title, message, fcmTokens, data, tokenUserMap);
  }
}
