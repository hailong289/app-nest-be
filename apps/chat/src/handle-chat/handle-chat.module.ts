import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { HandleChatGateway } from './handle-chat.gateway';

@Module({
  providers: [HandleChatGateway, HandleChatService],
})
export class HandleChatModule {}
