import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoConnectionModule } from './mongo-connection.module';
import {
  callHistoryModel,
  flashcardModel,
  flashcardDeckModel,
  friendshipModel,
  keysModel,
  messageHidesModel,
  messageReactionsModel,
  messageReadsModel,
  messagesModel,
  otpModel,
  quizModel,
  roomEventsModel,
  roomModel,
  roomsStateModel,
  roomsUsersStateModel,
  userModel,
  documentModel,
  aIEmbeddingModel,
  aIUsageLogModel,
  attachmentModel,
  notificationModel,
} from './model';
import todoProjectModel from './model/todo-project.model';
import todoModel from './model/todo.model';

@Global()
@Module({
  imports: [
    MongoConnectionModule,
    MongooseModule.forFeature([
      messagesModel,
      userModel,
      roomModel,
      friendshipModel,
      keysModel,
      otpModel,
      attachmentModel,
      roomEventsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messageReadsModel,
      messageHidesModel,
      messageReactionsModel,
      quizModel,
      flashcardModel,
      flashcardDeckModel,
      callHistoryModel,
      documentModel,
      aIEmbeddingModel,
      aIUsageLogModel,
      notificationModel,
      todoModel,
      todoProjectModel,
    ]),
  ],
  exports: [
    MongooseModule, // quan trọng: export để app con inject Model được
  ],
})
export class MongodbModule {}
