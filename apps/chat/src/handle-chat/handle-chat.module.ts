import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';

@Module({
  controllers: [HandleChatController],
  providers: [HandleChatService],
  imports: [RoomsModule],
})
export class HandleChatModule {}
