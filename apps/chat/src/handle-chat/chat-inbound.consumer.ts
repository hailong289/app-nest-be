import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Consumer,
  EachBatchPayload,
  Kafka,
  KafkaMessage,
  KafkaConfig as KafkaJsConfig,
} from 'kafkajs';
import { KafkaEvent } from '@app/dto/enum.type';
import { SharedKafkaConfig } from 'libs/kafka';
import { HandleChatService } from './handle-chat.service';
import type { InboundChatItem } from './handle-chat.service';

/**
 * Phase 1 — Raw kafkajs `eachBatch` consumer for `chat.inbound`.
 *
 * Replaces the old app-level setInterval micro-batch buffer with a REAL
 * broker-side batch consumer (modeled on hercules' proven pattern):
 *   - real Kafka batches (not 1-message-per-call like the NestJS transport),
 *   - explicit offset control (`resolveOffset` / `commitOffsetsIfNecessary`),
 *   - long-running heartbeat so big chunks don't trigger a rebalance.
 *
 * MẶC ĐỊNH BẬT (kafka là luồng mặc định). Chỉ tắt khi `CHAT_INGEST_MODE=grpc`
 * → `onModuleInit` no-op, không connect/consume, quay về luồng gRPC cũ. gRPC
 * CreateNewMsg + consumer MESSAGE_PERSISTED luôn còn nguyên (fallback an toàn).
 *
 * It reuses the SAME Kafka connection config the NestJS Kafka transport uses
 * (the `kafka` registerAs config → `SharedKafkaConfig.client`: brokers, ssl,
 * sasl, clientId), so brokers + SASL always match the rest of the service.
 */
@Injectable()
export class ChatInboundConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatInboundConsumer.name);
  private consumer: Consumer | null = null;

  /** Chunk size: how many messages we process per inner loop / commit. */
  private readonly chunkSize = Number(process.env.CHAT_INBOUND_CHUNK || 500);
  /** How many partitions kafkajs processes concurrently. */
  private readonly concurrency = Number(
    process.env.CHAT_INBOUND_CONCURRENCY || 3,
  );
  private readonly groupId =
    process.env.KAFKA_CHAT_INBOUND_CONSUMER || 'chat-inbound-batch';
  /**
   * Fetch long-poll window. kafkajs mặc định 5000ms → ở TẢI THẤP (1 tin) broker
   * giữ fetch tới 5s mới trả → độ trễ ~7s. Hạ xuống 50ms: 1 tin trả gần như tức
   * thì, mà TẢI CAO nhiều tin tới trong 50ms vẫn được gom thành batch (bulkWrite
   * theo lô) → low-latency + high-throughput cùng lúc.
   */
  private readonly maxWaitMs = Number(
    process.env.CHAT_INBOUND_MAX_WAIT_MS || 50,
  );

  constructor(
    private readonly config: ConfigService,
    private readonly hdChat: HandleChatService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Kafka ingest là MẶC ĐỊNH (luôn chạy). Chỉ tắt consumer khi đặt rõ
    // CHAT_INGEST_MODE=grpc (fallback về luồng gRPC cũ).
    if (process.env.CHAT_INGEST_MODE === 'grpc') return;

    const kafkaConfig = this.config.get<SharedKafkaConfig>('kafka');
    if (!kafkaConfig) {
      this.logger.error(
        '[CHAT_INBOUND] Kafka config not found — consumer NOT started.',
      );
      return;
    }

    // Reuse the exact same client config (brokers + ssl + sasl) the NestJS
    // Kafka transport uses; override only clientId for log clarity.
    const clientConfig: KafkaJsConfig = {
      ...(kafkaConfig.client as KafkaJsConfig),
      clientId: `${kafkaConfig.client.clientId || 'chat'}-inbound-batch`,
    };

    const kafka = new Kafka(clientConfig);
    this.consumer = kafka.consumer({
      groupId: this.groupId,
      // Trả fetch ngay khi có >=1 byte, không chờ gom đủ batch ở tải thấp.
      minBytes: 1,
      maxWaitTimeInMs: this.maxWaitMs,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic: KafkaEvent.CHAT_INBOUND });

    this.logger.log(
      `[CHAT_INBOUND] eachBatch consumer started — topic=${KafkaEvent.CHAT_INBOUND} ` +
        `group=${this.groupId} concurrency=${this.concurrency} chunk=${this.chunkSize} ` +
        `maxWaitMs=${this.maxWaitMs}`,
    );

    await this.consumer.run({
      partitionsConsumedConcurrently: this.concurrency,
      eachBatch: (payload) => this.handleEachBatch(payload),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      try {
        await this.consumer.disconnect();
      } catch (err) {
        this.logger.error(
          `[CHAT_INBOUND] consumer disconnect failed: ${
            (err as Error)?.message ?? String(err)
          }`,
        );
      }
    }
  }

  /**
   * Core eachBatch handler:
   *   chunk(batch.messages) → for each chunk: parse JSON values, group by
   *   payload.roomId, run handleInboundBatch per group → keep heartbeat alive
   *   while processing → resolveOffset per message → commitOffsetsIfNecessary.
   */
  private async handleEachBatch({
    batch,
    resolveOffset,
    commitOffsetsIfNecessary,
    heartbeat,
  }: EachBatchPayload): Promise<void> {
    const messages = batch.messages;
    if (messages.length === 0) return;

    for (let i = 0; i < messages.length; i += this.chunkSize) {
      const chunk = messages.slice(i, i + this.chunkSize);

      // Keep the consumer in the group while we process a (potentially large)
      // chunk — prevents a session-timeout rebalance mid-batch.
      const hb = setInterval(() => {
        void heartbeat().catch(() => undefined);
      }, 2000);

      try {
        // Group parsed items by roomId. roomId is read from the PARSED value
        // (robust even when message.key is absent). One handleInboundBatch call
        // per room keeps per-room aggregation/ordering intact.
        const itemsByRoom = new Map<string, InboundChatItem[]>();
        for (const message of chunk) {
          const item = this.parseMessage(message);
          if (!item) continue;
          const roomId = item.roomId;
          if (!roomId) continue;
          const arr = itemsByRoom.get(roomId);
          if (arr) arr.push(item);
          else itemsByRoom.set(roomId, [item]);
        }

        if (itemsByRoom.size > 0) {
          await Promise.all(
            Array.from(itemsByRoom.values()).map((items) =>
              this.hdChat.handleInboundBatch(items),
            ),
          );
        }
      } catch (err) {
        // NOTE (Phase 1b): no DLQ yet. Items are idempotent via `_id` (bulkWrite
        // upsert), so committing past a failed chunk is acceptable and avoids a
        // poison-batch infinite reprocess loop. A future DLQ should capture the
        // raw value + error for replay instead of silently moving on.
        this.logger.error(
          `[CHAT_INBOUND] chunk processing failed (partition=${batch.partition} ` +
            `size=${chunk.length}): ${(err as Error)?.message ?? String(err)}`,
        );
      } finally {
        clearInterval(hb);
      }

      // Mark every message in this chunk as processed (even on error — see NOTE).
      for (const message of chunk) {
        resolveOffset(message.offset);
      }
      await commitOffsetsIfNecessary();
    }
  }

  /** Parse a raw kafka message value (JSON) into an InboundChatItem, or null. */
  private parseMessage(message: KafkaMessage): InboundChatItem | null {
    try {
      const raw = message.value?.toString();
      if (!raw) return null;
      return JSON.parse(raw) as InboundChatItem;
    } catch (err) {
      this.logger.error(
        `[CHAT_INBOUND] bad message value (offset=${message.offset}): ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return null;
    }
  }
}
