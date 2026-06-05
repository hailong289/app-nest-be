import { Module } from '@nestjs/common';
import { SERVICES } from '@app/constants';
import { SharedKafkaClientModule } from 'libs/kafka';
import { ChangeFeedService } from './change-feed.service';

/**
 * Đóng gói `ChangeFeedService` + ClientKafka `SERVICES.CHAT` (chat tự emit
 * `OUTBOX_APPEND` cho chính nó) thành MỘT module dùng chung. Tách khỏi
 * `HandleChatModule` để `RoomsModule` cũng inject được `ChangeFeedService` mà
 * KHÔNG tạo vòng phụ thuộc (HandleChatModule đã import RoomsModule).
 *
 * `UserChangeEvent` model được đăng ký ở `MongodbModule` (@Global) nên
 * `@InjectModel(UserChangeEvent.name)` trong service resolve được, không cần
 * `forFeature` ở đây.
 */
const ChatSelfKafkaClient = SharedKafkaClientModule.registerAsync({
  name: SERVICES.CHAT,
  clientId: 'chat-service-self-client',
  groupId: 'chat-service-self-group',
});

@Module({
  imports: [ChatSelfKafkaClient],
  providers: [ChangeFeedService],
  // Re-export cả ClientKafka SERVICES.CHAT để importer (HandleChat/Rooms) inject
  // được cả `ChangeFeedService` lẫn `@Inject(SERVICES.CHAT) ClientKafka`.
  exports: [ChangeFeedService, ChatSelfKafkaClient],
})
export class ChangeFeedModule {}
