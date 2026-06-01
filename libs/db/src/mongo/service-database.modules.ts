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
      // gateway -> auth and filesystem lookups with API gateway -> filesystem.
      userModel,
      attachmentModel,
      documentModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class ChatDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([attachmentModel, documentModel]),
  ],
  exports: [MongooseModule],
})
export class FilesystemDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([aIEmbeddingModel, aIUsageLogModel]),
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
    ]),
  ],
  exports: [MongooseModule],
})
export class LearningDatabaseModule {}

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([notificationModel]),
  ],
  exports: [MongooseModule],
})
export class NotificationDatabaseModule {}
