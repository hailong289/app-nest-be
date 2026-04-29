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
import userModel from 'libs/db/src/mongo/model/user.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      QuizSchema,
      FlashcardSchema,
      flashcardDeckModel,
      flashcardProgressModel,
      TodoSchema,
      TodoProjectSchema,
      userModel,
    ]),
  ],
  controllers: [
    QuizzController,
    FlashcardController,
    TodoController,
  ],
  providers: [QuizzService, FlashcardService, TodoService, TodoProjectService],
  exports: [QuizzService, FlashcardService, TodoService, TodoProjectService],
})
export class LearningModule {}
