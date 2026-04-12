import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';
import { SERVICES } from '@app/constants';
import { SharedKafkaClientModule } from 'libs/kafka';

@Module({
  controllers: [HandleChatController],
  providers: [HandleChatService],
  imports: [
    RoomsModule,
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.AI,
      clientId: 'chat-service-ai-client',
      groupId: 'chat-service-ai-group',
    }),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.FILESYSTEM,
      clientId: 'chat-service-filesystem-client',
      groupId: 'chat-service-filesystem-group',
    }),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'chat-msg-notification',
      groupId: 'chat-msg-notification-group',
    }),
  ],
})
export class HandleChatModule {}
