import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";

@Controller('chat')
export class GatewayChatController {

    public constructor(
        @Inject(SERVICES.CHAT) private readonly chatClient: ClientProxy,
        private readonly gatewayService: GatewayService,
    ) { }

    // Chat endpoints
    @Get('chat/messages')
    async getMessages() {
        return await this.gatewayService.dispatchServiceRequest(this.chatClient, 'get_messages');
    }

    @Post('chat/send')
    async sendMessage(@Body() messageDto: any) {
        return await this.gatewayService.dispatchServiceRequest(this.chatClient, 'send_message', messageDto);
    }
}