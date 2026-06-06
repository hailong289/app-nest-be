import { Logger } from '@nestjs/common';
import { Consumer, EachBatchPayload, Kafka } from 'kafkajs';
import kafkaConfig from './kafka.config';

/**
 * Tuỳ chọn cho consumer LÔ (batch) bền vững — tái dùng cho mọi microservice cần
 * "ghi nền không bao giờ kẹt/bỏ sót" (write-behind storage, log usage, v.v.).
 */
export interface BulkBatchConsumerOptions<T> {
  /** Topic cần consume. */
  topic: string;
  /** clientId riêng cho consumer này (truy vết). */
  clientId: string;
  /** groupId; mặc định lấy từ kafkaConfig().consumer.groupId (config chung). */
  groupId?: string;
  /** Đọc từ đầu topic? Mặc định false (chỉ tin mới + tồn đọng chưa commit). */
  fromBeginning?: boolean;
  /**
   * Xử lý 1 LÔ record đã parse JSON. NÉM lỗi nếu xử lý thất bại (vd DB rớt) →
   * helper KHÔNG commit offset lô đó → Kafka giao lại → retry (at-least-once).
   * PHẢI idempotent (upsert theo khoá) vì có thể chạy lại.
   */
  handler: (records: T[]) => Promise<void>;
  logger?: Logger;
}

/**
 * Khởi tạo consumer LÔ BỀN VỮNG (raw kafkajs) theo CONFIG KAFKA CHUNG `kafkaConfig`
 * (giống KafkaAdminService) — KHÔNG hardcode broker/SASL/group.
 *
 * Đảm bảo KHÔNG KẸT / KHÔNG BỎ SÓT:
 *  - `autoCommit:false` + `eachBatchAutoResolve:false`: tự commit, CHỈ resolve
 *    offset SAU KHI `handler` ghi thành công → tin chưa ghi KHÔNG bị commit qua.
 *  - `handler` lỗi → không resolve phần tốt → Kafka giao lại → retry tới khi OK.
 *  - JSON hỏng (không thể xử lý mãi) → resolve để KHÔNG kẹt cả partition.
 *  - Drain từ offset chưa xử lý (ưu tiên tin tồn đọng).
 *
 * @returns Consumer (để caller disconnect lúc onModuleDestroy).
 */
export async function startBulkBatchConsumer<T = unknown>(
  opts: BulkBatchConsumerOptions<T>,
): Promise<Consumer> {
  const log = opts.logger ?? new Logger('BulkBatchConsumer');
  const cfg = kafkaConfig();
  const kafka = new Kafka({ ...cfg.client, clientId: opts.clientId });
  const consumer = kafka.consumer({
    ...cfg.consumer,
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: opts.topic,
    fromBeginning: opts.fromBeginning ?? false,
  });

  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    eachBatch: async (payload: EachBatchPayload) => {
      const { batch } = payload;
      const records: T[] = [];
      const good: string[] = [];
      const bad: string[] = [];

      for (const m of batch.messages) {
        if (!payload.isRunning() || payload.isStale()) break;
        if (!m.value) {
          bad.push(m.offset);
          continue;
        }
        try {
          records.push(JSON.parse(m.value.toString()) as T);
          good.push(m.offset);
        } catch (e) {
          log.error(
            `✗ bad JSON offset=${m.offset} topic=${opts.topic} → skip: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          bad.push(m.offset);
        }
      }

      if (records.length) {
        try {
          await opts.handler(records);
        } catch (e) {
          // Lỗi xử lý → KHÔNG resolve `good` → KHÔNG commit → redeliver/retry.
          log.error(
            `✗ handler fail (${records.length} recs, topic=${opts.topic}) → retry: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          for (const off of bad) payload.resolveOffset(off);
          await payload.commitOffsetsIfNecessary();
          return;
        }
        for (const off of good) payload.resolveOffset(off);
      }
      for (const off of bad) payload.resolveOffset(off);
      await payload.heartbeat();
      await payload.commitOffsetsIfNecessary();
    },
  });

  log.log(
    `✅ bulk consumer running topic=${opts.topic} group=${
      opts.groupId ?? cfg.consumer.groupId
    } (manual-commit + retry)`,
  );
  return consumer;
}
