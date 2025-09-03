// ...existing code...
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';

@Processor('notification')
@Injectable()
export class NotificationProcessor {
  @Process('welcome')
  async handleWelcomeEmail(job: Job<{ email: string; name: string }>) {
    const { email, name } = job.data;
    console.log(`Sending welcome email to ${email}`);
    // Gọi hàm gửi email thật ở đây (SendGrid, Mailgun, v.v.)
    // giả lập gửi email
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('✅ Email sent:', job.data);
    return true;
  }
}
