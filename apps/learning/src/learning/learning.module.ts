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

@Module({
  imports: [
    MongooseModule.forFeature([
      QuizSchema,
      FlashcardSchema,
      flashcardDeckModel,
      flashcardProgressModel,
      TodoSchema,
    ]),
  ],
  controllers: [QuizzController, FlashcardController, TodoController],
  providers: [QuizzService, FlashcardService, TodoService],
  exports: [QuizzService, FlashcardService, TodoService],
})
export class LearningModule {}
