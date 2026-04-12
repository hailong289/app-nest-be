// scripts/create-topics.ts
import { topics } from 'libs/kafka/kafka.topic';
import { Kafka } from 'kafkajs';

async function main() {
  try {
    console.log('🚀 Starting Kafka topic provisioning...');
    const brokersEnv =
      process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092';
    const brokers = brokersEnv
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    const kafkaConfig: any = { brokers };

    // Only add SASL/SSL config when provided
    if (process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD) {
      kafkaConfig.sasl = {
        mechanism: (process.env.KAFKA_SASL_MECHANISM as any) || 'scram-sha-256',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD,
      };
      // If SASL is used, let user opt-in to SSL via env
      if ((process.env.KAFKA_SSL || '').toLowerCase() === 'true') {
        kafkaConfig.ssl = true;
      }
    }

    const kafka = new Kafka(kafkaConfig);

    const admin = kafka.admin();

    const topicsToCreate = topics;

    await admin.createTopics({ topics: topicsToCreate });
    console.log('✅ Kafka topics provisioned successfully');

    await admin.disconnect();
  } catch (error) {
    console.error('❌ Error creating topics', error);
  }
}

main().catch((err) => {
  console.error('❌ Error creating topics', err);
  process.exit(1);
});
