import { registerAs } from '@nestjs/config';

export default registerAs('learning', () => ({
  host: process.env.CHAT_LEARNING_HOST || 'localhost',
  port: process.env.CHAT_LEARNING_PORT || '5007',
  protoPath: ['libs/grpc/quizz.proto', 'libs/grpc/flashcard.proto', 'libs/grpc/todo.proto'],
  nodeEnv: process.env.NODE_ENV || 'development',
}));
