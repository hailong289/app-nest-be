import { Body, Controller, Post } from "@nestjs/common";
import { NotificationService } from "./notification.service";

@Controller('notifications')
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) {}

    @Post('welcome')
    async sendWelcomeEmail(@Body() user: { email: string; name: string }) {
        return this.notificationService.sendWelcomeEmail(user);
    }
}