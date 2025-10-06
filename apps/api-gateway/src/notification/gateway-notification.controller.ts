import { Body, Controller, Inject, Post, OnModuleInit } from "@nestjs/common";
import { ClientKafka, ClientProxy } from "@nestjs/microservices";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";


@Controller('notifications')
export class GatewayNotificationController {
    public constructor(
        @Inject(SERVICES.NOTIFICATION) private readonly notificationClient: ClientKafka,
        private readonly gatewayService: GatewayService,
    ) { }

    @Post('send-otp')
    async sendOtp(@Body() body: { email: string; otp: string }) {
        return await this.gatewayService.dispatchServiceEvent(this.notificationClient, 'send_otp', body);
    }
}