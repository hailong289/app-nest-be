// scripts/create-topics.ts
import { Kafka } from 'kafkajs';

async function main() {
    try {
        console.log('🚀 Starting Kafka topic provisioning...');
        const kafka = new Kafka({
            brokers: [process.env.KAFKA_BROKER || ''],
            ssl: {},
            sasl: {
                mechanism: process.env.KAFKA_SASL_MECHANISM as any || "scram-sha-256", // scram-sha-256 or scram-sha-512 or plain
                username: process.env.KAFKA_SASL_USERNAME || 'user',
                password: process.env.KAFKA_SASL_PASSWORD || 'password',
            }
        });

        const admin = kafka.admin();

        const topicsToCreate = [
            { topic: 'upload_single_file', numPartitions: 1, replicationFactor: -1 },
            { topic: 'upload_single_file.reply', numPartitions: 1, replicationFactor: -1 },
            { topic: 'upload_multiple_files', numPartitions: 1, replicationFactor: -1 },
            { topic: 'upload_multiple_files.reply', numPartitions: 1, replicationFactor: -1 },
            { topic: 'delete_file', numPartitions: 1, replicationFactor: -1 },
            { topic: 'delete_file.reply', numPartitions: 1, replicationFactor: -1 },
            { topic: 'get_presigned_url', numPartitions: 1, replicationFactor: -1 },
            { topic: 'get_presigned_url.reply', numPartitions: 1, replicationFactor: -1 },
        ];

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
