import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { topics } from './kafka.topic';
import { SharedKafkaConfig } from './kafka.interface';

@Injectable()
export class KafkaAdminService implements OnModuleInit {
  private readonly logger = new Logger(KafkaAdminService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Không await để không block startup nếu Kafka không available
    this.createTopics().catch((error) => {
      this.logger.warn(
        '⚠️  Kafka topic creation failed, but service will continue:',
        error.message,
      );
    });
  }

  private async createTopics() {
    try {
      this.logger.log('🚀 Checking Kafka topics...');

      const kafkaConfig = this.configService.get<SharedKafkaConfig>('kafka');
      if (!kafkaConfig) {
        this.logger.warn('Kafka config not found, skipping topic creation');
        return;
      }

      const kafka = new Kafka({
        ...kafkaConfig.client,
        logLevel: logLevel.ERROR,
        // Thêm timeout để không block quá lâu
        connectionTimeout: 5000,
        requestTimeout: 5000,
      });
      const admin = kafka.admin();

      await admin.connect();

      const existingTopics = await admin.listTopics();
      const topicsToCreate = topics.filter(
        (t) => !existingTopics.includes(t.topic),
      );

      if (topicsToCreate.length > 0) {
        this.logger.log(
          `Creating topics: ${topicsToCreate.map((t) => t.topic).join(', ')}`,
        );
        await admin.createTopics({
          topics: topicsToCreate.map((t) => ({
            topic: t.topic,
            numPartitions: t.numPartitions,
            replicationFactor:
              t.replicationFactor === -1 ? 1 : t.replicationFactor, // Handle -1 if needed, usually 1 for local
          })),
        });
        this.logger.log('✅ Kafka topics created successfully');
      } else {
        this.logger.log('✅ All topics already exist');
      }

      // Topic đã tồn tại từ trước KHÔNG được createTopics cập nhật partition.
      // Kafka chỉ cho TĂNG partition (không giảm) → gọi createPartitions cho
      // topic nào đang ít hơn cấu hình. An toàn & idempotent: bỏ qua nếu đã đủ.
      try {
        const wantMultiPartition = topics.filter(
          (t) => existingTopics.includes(t.topic) && t.numPartitions > 1,
        );
        if (wantMultiPartition.length > 0) {
          const meta = await admin.fetchTopicMetadata({
            topics: wantMultiPartition.map((t) => t.topic),
          });
          const currentCount = new Map(
            meta.topics.map((t) => [t.name, t.partitions.length]),
          );
          const toGrow = wantMultiPartition.filter(
            (t) => (currentCount.get(t.topic) ?? 1) < t.numPartitions,
          );
          if (toGrow.length > 0) {
            this.logger.log(
              `Increasing partitions: ${toGrow
                .map((t) => `${t.topic}->${t.numPartitions}`)
                .join(', ')}`,
            );
            await admin.createPartitions({
              topicPartitions: toGrow.map((t) => ({
                topic: t.topic,
                count: t.numPartitions,
              })),
            });
            this.logger.log('✅ Kafka partitions increased');
          }
        }
      } catch (err) {
        this.logger.warn(
          `⚠️  Increase partitions skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await admin.disconnect();
    } catch (error) {
      this.logger.error('❌ Error creating topics', error);
    }
  }
}
