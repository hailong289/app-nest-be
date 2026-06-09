import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { kafkaConfig, startBulkBatchConsumer } from 'libs/kafka';
import { KafkaEvent, MessageStoreRecord } from '@app/dto';
import { MessageStoreService } from './message-store.service';

/**
 * Consumer write-behind: ghi message row vào DB từ topic `chat.messageStore`.
 * Dùng helper CHUNG `startBulkBatchConsumer` (libs/kafka) — at-least-once,
 * commit thủ công sau khi ghi OK, retry khi lỗi → KHÔNG bao giờ kẹt/bỏ sót.
 * Logic ghi nằm ở MessageStoreService (idempotent upsert). Helper tái dùng được
 * cho các microservice khác cần ghi nền bền vững.
 */
@Injectable()
export class MessageStoreConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageStoreConsumer.name);
  private consumer: Consumer | null = null;

  constructor(private readonly store: MessageStoreService) {}

  async onModuleInit(): Promise<void> {
    const clientId = `${kafkaConfig().client.clientId || 'chat'}-storage`;
    this.consumer = await startBulkBatchConsumer<MessageStoreRecord>({
      topic: KafkaEvent.MESSAGE_STORE,
      clientId,
      handler: async (records) => {
        await this.store.persistMany(records);
      },
      logger: this.logger,
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.consumer?.disconnect();
    } catch {
      /* ignore */
    }
  }
}
