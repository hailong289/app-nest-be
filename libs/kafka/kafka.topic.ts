import { KafkaEvent } from '@app/dto';

export const topics = Object.values(KafkaEvent).map((topicName) => ({
  topic: topicName,
  numPartitions: 1,
  replicationFactor: -1, // Sử dụng default của broker
}));
