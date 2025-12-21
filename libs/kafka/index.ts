// libs/common/src/kafka/index.ts

// 1. Config thường là default export (do dùng registerAs) -> OK
export { default as kafkaConfig } from './kafka.config';

// 2. Module là Named Export (export class SharedKafkaClientModule)
// Dùng dấu * để export tất cả class bên trong ra
export * from './kafka-client.module';

// 3. Interface cũng là Named Export
// Dùng dấu * để lấy hết các type (SharedKafkaConfig, KafkaTopicNames...)
export * from './kafka.interface';

export * from './kafka-admin.service';
