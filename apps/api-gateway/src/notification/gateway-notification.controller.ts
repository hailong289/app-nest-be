import { Body, Controller, Inject, Post, OnModuleInit } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";


@Controller('notifications')
export class GatewayNotificationController {
    public constructor(
        @Inject('NOTIFICATION_SERVICE') private readonly notificationClient: ClientProxy
    ) { }

     // Notification endpoints
    @Post('notifications/welcome')
    async sendWelcomeEmail(@Body() user: { email: string; name: string }) {
        try {
            return await firstValueFrom(this.notificationClient.send('send_welcome_email', user));
        } catch (error) {
            console.error('Send welcome email error:', error);
            return { success: false, message: 'Notification service unavailable' };
        }
    }

    @Post('notifications/push')
    async sendPushNotification(@Body() notification: {
        tokens: string[];
        title: string;
        body: string;
        data: Record<string, string>;
    }) {
        try {
            return await firstValueFrom(this.notificationClient.send('send_push_notification', notification));
        } catch (error) {
            console.error('Send push notification error:', error);
            return { success: false, message: 'Notification service unavailable' };
        }
    }
}