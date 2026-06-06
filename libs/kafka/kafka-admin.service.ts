import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { topics, PARTITION_OVERRIDES } from './kafka.topic';
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
      this.logger.log(
        `📋 Existing topics (${existingTopics.length}): ${existingTopics.join(', ')}`,
      );
      const topicsToCreate = topics.filter(
        (t) => !existingTopics.includes(t.topic),
      );

      if (topicsToCreate.length > 0) {
        this.logger.log(
          `Creating ${topicsToCreate.length} topic(s): ${topicsToCreate
            .map((t) => t.topic)
            .join(', ')}`,
        );
        // Tạo TỪNG topic riêng + chờ leader: 1 topic lỗi (vd replicationFactor
        // không hợp lệ) KHÔNG kéo cả mẻ fail, và log rõ topic nào fail. Trước đây
        // gọi 1 cục → 1 lỗi là MỌI topic mới (gồm chat.outboxAppend) không được tạo.
        for (const t of topicsToCreate) {
          try {
            // KHÔNG dùng waitForLeaders: với KRaft single-node, poll metadata
            // leader ngay sau create hay báo "does not host this topic-partition"
            // (topic đã tạo nhưng leader chưa gán kịp). Create rồi return luôn.
            const created = await admin.createTopics({
              topics: [
                {
                  topic: t.topic,
                  numPartitions: t.numPartitions,
                  replicationFactor:
                    t.replicationFactor === -1 ? 1 : t.replicationFactor,
                },
              ],
            });
            this.logger.log(
              `  ${created ? '✅ created' : 'ℹ️ exists'} topic: ${t.topic}`,
            );
          } catch (e) {
            this.logger.error(
              `  ❌ FAILED to create topic ${t.topic}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
        }
        this.logger.log('✅ Kafka topic creation pass done');
      } else {
        this.logger.log('✅ All topics already exist');
      }

      // Tăng partition cho topic miền chat ĐÃ TỒN TẠI với số partition cũ
      // (createTopics no-op nếu topic đã có → không tự bump). Chỉ TĂNG, không giảm.
      // CAVEAT: đổi ánh xạ key→partition cho record MỚI → chạy lúc traffic thấp.
      await this.ensurePartitions(admin);

      await admin.disconnect();
    } catch (error) {
      this.logger.error('❌ Error creating topics', error);
    }
  }

  /**
   * Đảm bảo các topic trong PARTITION_OVERRIDES có ĐỦ số partition mong muốn.
   * Topic mới đã sinh đúng số partition ở createTopics; hàm này chỉ xử lý topic
   * ĐÃ TỒN TẠI từ trước với ít partition hơn (vd `chat.messagePersisted`/
   * `chat.outboxAppend` cũ = 1). `createPartitions` chỉ tăng được, không giảm.
   * Lỗi 1 topic không chặn topic khác.
   */
  private async ensurePartitions(admin: ReturnType<Kafka['admin']>) {
    const targets = Object.entries(PARTITION_OVERRIDES).filter(
      ([, count]) => count > 1,
    );
    if (targets.length === 0) return;
    let meta: Awaited<ReturnType<typeof admin.fetchTopicMetadata>>;
    try {
      meta = await admin.fetchTopicMetadata({
        topics: targets.map(([topic]) => topic),
      });
    } catch (e) {
      this.logger.warn(
        `⚠️  Không lấy được metadata để bump partition: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    const current = new Map(
      meta.topics.map((t) => [t.name, t.partitions.length]),
    );
    for (const [topic, desired] of targets) {
      const have = current.get(topic) ?? 0;
      if (have === 0 || have >= desired) continue; // chưa tồn tại / đã đủ
      try {
        await admin.createPartitions({
          topicPartitions: [{ topic, count: desired }],
        });
        this.logger.log(`🔀 bumped partitions ${topic}: ${have} → ${desired}`);
      } catch (e) {
        this.logger.error(
          `  ❌ FAILED to bump partitions ${topic}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
}
