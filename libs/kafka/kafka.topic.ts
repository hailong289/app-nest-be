export const topic = [
  { topic: 'upload_single_file', numPartitions: 1, replicationFactor: -1 },
  {
    topic: 'upload_single_file.reply',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'upload_multiple_files',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'upload_multiple_files.reply',
    numPartitions: 1,
    replicationFactor: -1,
  },
  { topic: 'delete_file', numPartitions: 1, replicationFactor: -1 },
  { topic: 'delete_file.reply', numPartitions: 1, replicationFactor: -1 },
  { topic: 'get_presigned_url', numPartitions: 1, replicationFactor: -1 },
  {
    topic: 'get_presigned_url.reply',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'create_rooms',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'ai.createChatMessageEmbedding',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'filesystem.processLink',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'document.shareforRoom',
    numPartitions: 1,
    replicationFactor: -1,
  },
  // Notification topics
  {
    topic: 'send_otp',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'forgot_password',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'push_notification',
    numPartitions: 1,
    replicationFactor: -1,
  },
  {
    topic: 'push_notification_users',
    numPartitions: 1,
    replicationFactor: -1,
  },
];
