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
      // Legacy cross-service reads. Remove these after replacing with APIs/events.
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
      // Legacy cross-service reads. Remove these after replacing with APIs/events.
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
      // Legacy cross-service reads. Remove these after replacing with Kafka snapshots.
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
      // Legacy cross-service reads. Remove these after replacing with APIs/events.
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
      // Legacy cross-service reads. Replace with NotificationDevices projection.
      keysModel,
    ]),
  ],
  exports: [MongooseModule],
})
export class NotificationDatabaseModule {}
