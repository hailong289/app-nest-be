import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { QuizzController } from '../quizz/quizz.controller';
import { QuizzService } from '../quizz/quizz.service';
import QuizSchema from 'libs/db/src/mongo/model/quiz.model';

import { FlashcardController } from '../flashcard/flashcard.controller';
import { FlashcardService } from '../flashcard/flashcard.service';
import FlashcardSchema, {
  flashcardDeckModel,
  flashcardProgressModel,
} from 'libs/db/src/mongo/model/flashcard.model';

import { TodoController } from '../todo/todo.controller';
import { TodoService } from '../todo/todo.service';
import TodoSchema from 'libs/db/src/mongo/model/todo.model';
import TodoProjectSchema from 'libs/db/src/mongo/model/todo-project.model';
import { TodoProjectService } from '../todo/todo-project.service';
import { GatewayClientService } from '../gateway-client.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      QuizSchema,
      FlashcardSchema,
      flashcardDeckModel,
      flashcardProgressModel,
      TodoSchema,
      TodoProjectSchema,
    ]),
  ],
  controllers: [
    QuizzController,
    FlashcardController,
    // TodoController owns ALL 19 @GrpcMethod handlers for `TodoService`
    // — both todo.* and project.* (it injects TodoProjectService and
    // forwards). The standalone TodoProjectController in
    // apps/learning/src/todo/todo-project.controller.ts is a leftover
    // duplicate; keeping both registered creates two handlers for the
    // same gRPC method (e.g. CreateProject) and NestJS silently picks
    // one — easy way to ship "no-op" endpoints. Don't add
    // TodoProjectController here.
    TodoController,
  ],
  providers: [
    QuizzService,
    FlashcardService,
    TodoService,
    TodoProjectService,
    GatewayClientService,
  ],
  exports: [QuizzService, FlashcardService, TodoService, TodoProjectService],
})
export class LearningModule {}
