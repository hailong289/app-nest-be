import { KafkaEvent } from '@app/dto';

/**
 * Số partition cho các topic MIỀN CHAT (key = room_id) — cho phép consumer scale
 * ngang mà vẫn giữ thứ tự trong từng phòng (cùng room_id → cùng partition).
 * Mặc định 12, override qua KAFKA_CHAT_PARTITIONS. Xem plan write-behind (Phần D).
 */
export const CHAT_PARTITIONS = Math.max(
  1,
  Number.parseInt(process.env.KAFKA_CHAT_PARTITIONS || '12', 10) || 12,
);

/**
 * Override số partition theo từng topic. Topic không có trong map → 1 partition
 * (giữ nguyên hành vi cũ cho notification/AI/doc/file…). Chỉ luồng chat cần
 * partition để chịu burst.
 */
export const PARTITION_OVERRIDES: Record<string, number> = {
  [KafkaEvent.MESSAGE_STORE]: CHAT_PARTITIONS,
  [KafkaEvent.MESSAGE_PERSISTED]: CHAT_PARTITIONS,
  [KafkaEvent.OUTBOX_APPEND]: CHAT_PARTITIONS,
};

export const topics = Object.values(KafkaEvent).map((topicName) => ({
  topic: topicName,
  numPartitions: PARTITION_OVERRIDES[topicName] ?? 1,
  replicationFactor: -1, // Sử dụng default của broker
}));
