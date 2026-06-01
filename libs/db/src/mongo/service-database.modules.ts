import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  aIEmbeddingModel,
  aIUsageLogModel,
  attachmentModel,
  callHistoryModel,
  documentModel,
  flashcardDeckModel,
  flashcardModel,
  friendshipModel,
  keysModel,
  messageHidesModel,
  messageReactionsModel,
  messageReadsModel,
  messagesModel,
  notificationModel,
  otpModel,
  quizModel,
  roomEventsModel,
  roomModel,
  roomsStateModel,
  roomsUsersStateModel,
  userModel,
} from './model';
import { flashcardProgressModel } from './model/flashcard.model';
import todoProjectModel from './model/todo-project.model';
import todoModel from './model/todo.model';
import { MongoConnectionModule } from './mongo-connection.module';

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([userModel, otpModel, keysModel]),
  ],
  exports: [MongooseModule],
})
export class AuthDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      roomModel,
      roomEventsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messagesModel,
      messageReadsModel,
      messageHidesModel,
      messageReactionsModel,
      friendshipModel,
      callHistoryModel,
      // Legacy cross-service reads (Sprint 5): replace auth lookups with API
      // gateway -> auth, filesystem lookups with API gateway -> filesystem,
      // and learning card lookups with API gateway -> learning.
      userModel,
      keysModel,
      attachmentModel,
      documentModel,
      quizModel,
      todoProjectModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class ChatDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      attachmentModel,
      documentModel,
      // Legacy cross-service reads (Sprint 3): replace user/room/message reads
      // with API gateway -> auth/chat contracts before DB cutover.
      userModel,
      roomModel,
      messagesModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class FilesystemDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      aIEmbeddingModel,
      aIUsageLogModel,
      // Legacy cross-service reads (Sprint 1): replace with Kafka payloads or
      // API gateway -> owner lookups for on-demand compatibility paths.
      userModel,
      messagesModel,
      attachmentModel,
      documentModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class AiDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      quizModel,
      flashcardModel,
      flashcardDeckModel,
      flashcardProgressModel,
      todoModel,
      todoProjectModel,
      // Legacy cross-service reads (Sprint 4): replace with API gateway ->
      // auth/chat and keep ObjectId/business-id conversion in auth.
      userModel,
      messagesModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class LearningDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      notificationModel,
      // Legacy cross-service reads (Sprint 2): replace Keys lookup with Redis
      // first and API gateway -> auth fallback. Do not add notification token collections.
      keysModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class NotificationDatabaseModule {}
