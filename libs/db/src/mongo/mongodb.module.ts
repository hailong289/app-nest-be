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

/**
 * @deprecated MongodbModule is a legacy global module that registers ALL models in one place.
 *
 * - Do NOT import this module in any new app or module.
 * - Existing apps that still depend on this module must migrate to their own
 *   `*DatabaseModule` (e.g. AuthDatabaseModule, ChatDatabaseModule, etc.)
 *   before this module can be deleted.
 * - Tracked for removal in the service DB split sprint plan.
 *   @see docs/service-database-split-plan.md
 *
 * Sprint 0 guardrail: the check:db-ownership CI script will FAIL if any app
 * imports this module. Fix by importing the correct `*DatabaseModule` instead.
 */
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
