import { SERVICES } from '@app/constants';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayQuizzController } from './quizz/gateway-quizz.controller';
import { GatewayFlashcardController } from './flashcard/gateway-flashcard.controller';
import { GatewayTodoController } from './todo/gateway-todo.controller';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import learningConfig from '../config/learning.config';

@Module({
  imports: [
    ConfigModule.forFeature(learningConfig),
    GrpcClientModule.registerAsync({
      name: SERVICES.LEARNING,
      configKey: 'learning',
      packages: ['quizz', 'flashcard', 'todo'],
    }),
  ],
  controllers: [
    GatewayQuizzController,
    GatewayFlashcardController,
    GatewayTodoController,
  ],
  providers: [GatewayService],
})
export class GatewayLearningModule {}
