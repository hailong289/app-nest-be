// scripts/create-topics.ts
import { Kafka } from 'kafkajs';

async function main() {
    try {
        console.log('🚀 Starting Kafka topic provisioning...');
        const kafka = new Kafka({
            clientId: 'filesystem-service',
            brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
            
        });

        const admin = kafka.admin();
        await admin.connect();


        // const topicsAuthToCreate = [
        //     { topic: 'login', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'login.reply', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'register', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'register.reply', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'logout', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'logout.reply', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'get_user', numPartitions: 1, replicationFactor: 1 },
        //     { topic: 'get_user.reply', numPartitions: 1, replicationFactor: 1 },
        // ];

        const topicsToCreate = [
            { topic: 'upload_single_file', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_single_file.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_multiple_files', numPartitions: 1, replicationFactor: 1 },
            { topic: 'upload_multiple_files.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'delete_file', numPartitions: 1, replicationFactor: 1 },
            { topic: 'delete_file.reply', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_presigned_url', numPartitions: 1, replicationFactor: 1 },
            { topic: 'get_presigned_url.reply', numPartitions: 1, replicationFactor: 1 },
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
