/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
import path from 'path';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { EmbeddingService } from './embedding.service';
import AIUsageLogSchema from 'libs/db/src/mongo/model/AIUsageLogs.model';
import googleConfig from './config/google.config';
import { GoogleModerationProvider } from './google.provider';
import AIEmbeddingSchema from 'libs/db/src/mongo/model/AIEmbedding.model';
import QuizSchema from 'libs/db/src/mongo/model/quiz.model';
import Userschema from 'libs/db/src/mongo/model/user.model';
import MessageSchema from 'libs/db/src/mongo/model/messages.model';
import { mongoConfig } from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { AiLogUseService } from './ai-log-use.service';
import { QuizzController } from './quizz/quizz.controller';
import { QuizzService } from './quizz/quizz.service';
import { FlashcardController } from './flashcard/flashcard.controller';
import { FlashcardService } from './flashcard/flashcard.service';
import FlashcardSchema from 'libs/db/src/mongo/model/flashcard.model';
import { flashcardDeckModel, flashcardProgressModel } from 'libs/db/src/mongo/model/flashcard.model';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/ai/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [googleConfig, mongoConfig, kafkaConfig],
    }),
    KafkaAdminModule,
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      AIUsageLogSchema,
      AIEmbeddingSchema,
      QuizSchema,
      Userschema,
      MessageSchema,
      FlashcardSchema,
      flashcardDeckModel,
      flashcardProgressModel,
    ]),
  ],
  controllers: [AIController, QuizzController, FlashcardController],
  providers: [
    AIService,
    EmbeddingService,
    GoogleModerationProvider,
    AiLogUseService,
    QuizzService,
    FlashcardService,
  ],
})
export class AppModule {}
