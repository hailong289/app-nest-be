import { KafkaModule } from 'libs/kafka/kafka.module';
import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';
import { SERVICES } from '@app/constants';

@Module({
  controllers: [HandleChatController],
  providers: [HandleChatService],
  imports: [RoomsModule, KafkaModule.register(SERVICES.AI)],
})
export class HandleChatModule {}
