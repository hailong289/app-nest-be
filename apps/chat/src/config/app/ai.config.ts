import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  host: process.env.CHAT_AI_HOST || 'localhost',
  port: process.env.CHAT_AI_PORT || '5004',
  protoPath: ['libs/grpc/ai.proto', 'libs/grpc/quizz.proto', 'libs/grpc/flashcard.proto', 'libs/grpc/todo.proto'],
  nodeEnv: process.env.NODE_ENV || 'development',
}));
