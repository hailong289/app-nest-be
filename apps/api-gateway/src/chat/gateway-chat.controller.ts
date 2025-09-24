import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";

@Controller('chat')
export class GatewayChatController {

    public constructor(
        @Inject('CHAT_SERVICE') private readonly chatClient: ClientProxy,
    ) { }

    // Chat endpoints
    @Get('chat/messages')
    async getMessages() {
        try {
            return await firstValueFrom(this.chatClient.send('get_messages', {}));
        } catch (error) {
            console.error('Get messages error:', error);
            return { success: false, message: 'Chat service unavailable' };
        }
    }

    @Post('chat/send')
    async sendMessage(@Body() messageDto: any) {
        try {
            return await firstValueFrom(this.chatClient.send('send_message', messageDto));
        } catch (error) {
            console.error('Send message error:', error);
            return { success: false, message: 'Chat service unavailable' };
        }
    }
}