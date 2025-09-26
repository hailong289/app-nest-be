// scripts/create-topics.ts
import { Kafka } from 'kafkajs';

async function main() {
    try {
        console.log('🚀 Starting Kafka topic provisioning...');
        const kafkaAuth = new Kafka({
            clientId: 'auth-service',
            brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
        });
        const kafkaFilesystem = new Kafka({
            clientId: 'filesystem-service',
            brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
            
        });

        const adminAuth = kafkaAuth.admin();
        await adminAuth.connect();
        const adminFilesystem = kafkaFilesystem.admin();
        await adminFilesystem.connect();


        const topicsAuthToCreate = [
            { topic: 'login', numPartitions: 1, replicationFactor: 1 },
            { topic: 'login.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'register', numPartitions: 1, replicationFactor: 1 },
            { topic: 'register.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'logout', numPartitions: 1, replicationFactor: 1 },
            { topic: 'logout.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_user', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_user.reply', numPartitions: 1, replicationFactor: 1 },
        ];

        const topicsFilesystemToCreate = [
            { topic: 'upload_single_file', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_single_file.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_multiple_files', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_multiple_files.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'delete_file', numPartitions: 1, replicationFactor: 1 },
            { topic: 'delete_file.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_presigned_url', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_presigned_url.reply', numPartitions: 1, replicationFactor: 1 },
        ];

        await adminAuth.createTopics({ topics: topicsAuthToCreate });
        await adminFilesystem.createTopics({ topics: topicsFilesystemToCreate });
        console.log('✅ Kafka topics provisioned successfully');

        await adminAuth.disconnect();
        await adminFilesystem.disconnect();
    } catch (error) {
        console.error('❌ Error creating topics', error);
    }
}

main().catch((err) => {
    console.error('❌ Error creating topics', err);
    process.exit(1);
});
