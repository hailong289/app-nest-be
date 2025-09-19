import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { FirebaseService } from './firebase.service';

@Processor('notification')
@Injectable()
export class NotificationProcessor {
  constructor(private readonly firebaseService: FirebaseService) {}

  @Process('welcome')
  async handleWelcomeEmail(job: Job<{ email: string; name: string }>) {
    const { email, name } = job.data;
    console.log(`Sending welcome email to ${email}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('✅ Email sent:', job.data);
    return true;
  }

  @Process('pushNotification')
  async handlePushNotification(
    job: Job<{
      tokens: string[];
      title: string;
      body: string;
      data: Record<string, string>;
    }>,
  ) {
    const { title, body, tokens, data } = job.data;
    const message = {
      tokens: tokens,
      notification: {
        title: title,
        body: body,
      },
      data: data,
      android: {
        priority: 'high' as 'high',
        notification: {
          sound: 'default',
          channelId: 'chat_messages',
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
    };
    try {
      await this.firebaseService.getMessaging().sendEachForMulticast(message);
      console.log('✅ Push notification sent:', job.data);
    } catch (error) {
      console.error('❌ Push notification error:', error);
    }
    return true;
  }
}