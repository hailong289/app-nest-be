import { KafkaEvent } from '@app/dto';

/**
 * Số partition cho các topic tail lưu lượng cao → cho phép consumer xử lý
 * song song (nhiều instance, hoặc `partitionsConsumedConcurrently` trong 1
 * instance). Topic KHÔNG liệt kê giữ mặc định 1 partition.
 *
 * Lưu ý ordering: tăng partition = message rải nhiều partition. Topic cần giữ
 * thứ tự theo room PHẢI produce kèm key=roomId (cùng room → cùng partition) —
 * xem `MESSAGE_PERSISTED` ở handle-chat.service. Các topic dưới đây không keyed
 * đều là tail độc lập theo từng item (embedding / push / summary), xử lý lệch
 * thứ tự vô hại. `OUTBOX_APPEND` (change-feed theo seq) cố ý GIỮ 1 partition.
 */
const PARTITIONS_BY_TOPIC: Partial<Record<KafkaEvent, number>> = {
  [KafkaEvent.MESSAGE_PERSISTED]: 6, // keyed=roomId → giữ thứ tự trong room
  [KafkaEvent.AI_CHAT_MSG_EMBEDDING]: 3,
  [KafkaEvent.AI_DOC_EMBEDDING]: 3,
  [KafkaEvent.AI_PROCESS_FILE_EMBEDDING]: 3,
  [KafkaEvent.PUSH_NOTIFICATION]: 3,
  [KafkaEvent.PUSH_NOTIFICATION_USERS]: 3,
  [KafkaEvent.FILE_SUMMARY_READY]: 3,
};

const DEFAULT_PARTITIONS = Number(process.env.KAFKA_DEFAULT_PARTITIONS ?? 1);

export const topics = Object.values(KafkaEvent).map((topicName) => ({
  topic: topicName,
  numPartitions:
    PARTITIONS_BY_TOPIC[topicName as KafkaEvent] ?? DEFAULT_PARTITIONS,
  replicationFactor: -1, // Sử dụng default của broker
}));
