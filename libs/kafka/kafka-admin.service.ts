import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { topic } from './kafka.topic';
import { SharedKafkaConfig } from './kafka.interface';

@Injectable()
export class KafkaAdminService implements OnModuleInit {
  private readonly logger = new Logger(KafkaAdminService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.createTopics();
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
      });
      const admin = kafka.admin();

      await admin.connect();

      const existingTopics = await admin.listTopics();
      const topicsToCreate = topic.filter(
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

      await admin.disconnect();
    } catch (error) {
      this.logger.error('❌ Error creating topics', error);
    }
  }
}
