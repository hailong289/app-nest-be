import { Body, Controller, Inject, Post, OnModuleInit } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";


@Controller('notifications')
export class GatewayNotificationController {
    public constructor(
        @Inject(SERVICES.NOTIFICATION) private readonly notificationClient: ClientProxy,
        private readonly gatewayService: GatewayService,
    ) { }

     // Notification endpoints
    @Post('notifications/welcome')
    async sendWelcomeEmail(@Body() user: { email: string; name: string }) {
        return await this.gatewayService.dispatchServiceRequest(this.notificationClient, 'send_welcome_email', user);
    }

    @Post('notifications/push')
    async sendPushNotification(@Body() notification: {
        tokens: string[];
        title: string;
        body: string;
        data: Record<string, string>;
    }) {
        return await this.gatewayService.dispatchServiceRequest(this.notificationClient, 'send_push_notification', notification);
    }
}