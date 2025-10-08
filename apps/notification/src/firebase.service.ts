import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

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
        priority: "high",
        notification: {
          sound: "default",
          channelId: "notifications",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };
    try {
      await this.getMessaging().sendEachForMulticast(payload);
    } catch (error) {
      console.error('🔥 Firebase Cloud Messaging error:', error);
    }
    return true;
  }
}
