/**
 * DI token cho Kafka producer client của ingest path (chat.inbound).
 *
 * Để ở file RIÊNG (không trong chat.module.ts) nhằm tránh circular import giữa
 * chat.module.ts (import ChatGateway) và chat-gateway.ts (import token này) —
 * vòng lặp đó khiến `@Inject(CHAT_KAFKA_PRODUCER)` nhận `undefined` lúc decorator
 * chạy → Nest báo "can't resolve dependencies ... index [1]".
 */
export const CHAT_KAFKA_PRODUCER = 'CHAT_KAFKA_PRODUCER';
