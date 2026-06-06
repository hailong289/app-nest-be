import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import path from 'node:path';
import { mongoConfig, MongodbModule } from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { HealthController } from './health.controller';
import { MessageStoreConsumer } from './message-store.consumer';
import { MessageStoreService } from './message-store.service';

/**
 * App write-behind storage: consume `chat.messageStore` (raw kafkajs eachBatch,
 * at-least-once — KHÔNG bao giờ kẹt/bỏ sót) rồi bulk upsert message row. Tách
 * process riêng để cô lập consumer group + scale/restart độc lập với chat gRPC.
 * Dùng chung Mongo/Kafka config với chat. Xem plan write-behind (Phần A4 / D).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/chat-storage/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [mongoConfig, kafkaConfig],
    }),
    MongodbModule,
  ],
  controllers: [HealthController],
  providers: [MessageStoreService, MessageStoreConsumer],
})
export class AppModule {}
