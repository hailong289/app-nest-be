/*
https://docs.nestjs.com/modules
*/

import { SERVICES } from '@app/constants';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayAiController } from './gateway-ai.controller';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayQuizzController } from './quizz/gateway-quizz.controller';
import { GatewayFlashcardController } from './flashcard/gateway-flashcard.controller';
import { GatewayTodoController } from './todo/gateway-todo.controller';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import aiConfig from '../config/ai.config';

@Module({
  imports: [
    ConfigModule.forFeature(aiConfig),
    GrpcClientModule.registerAsync({
      name: SERVICES.AI,
      configKey: 'ai',
      packages: ['ai', 'quizz', 'flashcard', 'todo'],
    }),
  ],
  controllers: [
    GatewayAiController,
    GatewayQuizzController,
    GatewayFlashcardController,
    GatewayTodoController,
  ],
  providers: [GatewayService],
})
export class GatewayAiModule {}
