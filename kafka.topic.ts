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
];
