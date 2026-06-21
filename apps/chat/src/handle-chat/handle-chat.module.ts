import { Module } from '@nestjs/common';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';
import { UnreadFlushService } from './unread-flush.service';
import { ChatInboundConsumer } from './chat-inbound.consumer';
import { ChangeFeedModule } from '../change-feed/change-feed.module';
import { SERVICES } from '@app/constants';
import { SharedKafkaClientModule } from 'libs/kafka';

@Module({
  controllers: [HandleChatController],
  // ChatInboundConsumer: raw kafkajs `eachBatch` consumer for `chat.inbound`.
  // No-op unless CHAT_INGEST_MODE=kafka (gated in its onModuleInit).
  providers: [HandleChatService, UnreadFlushService, ChatInboundConsumer],
  imports: [
    RoomsModule,
    // ChangeFeedService + ClientKafka SERVICES.CHAT (chat tự emit cho chính nó)
    // được cung cấp từ ChangeFeedModule — tách ra để RoomsModule cũng dùng được
    // mà không tạo vòng phụ thuộc với HandleChatModule.
    ChangeFeedModule,
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
