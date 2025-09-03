import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationService {
    constructor(@InjectQueue('notification') private readonly notificationQueue: Queue) { }

    async sendWelcomeEmail(user: { email: string; name: string }) {
        const jobPromise = this.notificationQueue.add('welcome', user, {
            attempts: 3,
            backoff: 5000,
            removeOnComplete: true,
            removeOnFail: false,
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('⏰ Redis connect timeout')), 2000),
        );

        try {
            await Promise.race([jobPromise, timeoutPromise]);
            return { success: true, message: 'Job queued!' };
        } catch (err) {
            console.error('❌ Queue add failed:', err.message);
            return { success: false, message: 'Không thể push vào queue', error: err.message };
        }
    }
}
