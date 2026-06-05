import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';
import { UnreadFlushService } from './unread-flush.service';
import { ChangeFeedService } from '../change-feed/change-feed.service';
import { SERVICES } from '@app/constants';
import { SharedKafkaClientModule } from 'libs/kafka';

@Module({
  controllers: [HandleChatController],
  providers: [HandleChatService, UnreadFlushService, ChangeFeedService],
  exports: [ChangeFeedService],
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
    // Client để chat EMIT event MESSAGE_PERSISTED cho chính nó (tail bất đồng bộ).
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.CHAT,
      clientId: 'chat-service-self-client',
      groupId: 'chat-service-self-group',
    }),
  ],
})
export class HandleChatModule {}
