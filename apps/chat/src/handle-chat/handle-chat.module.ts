import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HandleChatService } from './handle-chat.service';
import { RoomsModule } from '../rooms/rooms.module';
import { HandleChatController } from './handle-chat.controller';
import { SERVICES } from '@app/constants';
import { SharedKafkaClientModule } from 'libs/kafka';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { CacheModule } from '../cache/cache.module';
import {
  roomModel,
  messagesModel,
  messageReadsModel,
  roomsStateModel,
  roomsUsersStateModel,
  messageReactionsModel,
  messageHidesModel,
  friendshipModel,
  callHistoryModel,
} from 'libs/db/src';

@Module({
  controllers: [HandleChatController],
  providers: [HandleChatService],
  imports: [
    MongooseModule.forFeature([
      roomModel,
      messagesModel,
      messageReadsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messageReactionsModel,
      messageHidesModel,
      friendshipModel,
      callHistoryModel,
    ]),
    RoomsModule,
    CacheModule,
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.AI,
      clientId: 'chat-service-ai-client',
      groupId: 'chat-service-ai-group',
    }),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.FILESYSTEM,
      clientId: 'chat-service-filesystem-client',
      groupId: 'chat-service-filesystem-group',
    }),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'chat-msg-notification',
      groupId: 'chat-msg-notification-group',
    }),
    // gRPC clients for database isolation cross-service hydration
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
    GrpcClientModule.registerAsync({
      name: 'FILESYSTEM_GRPC',
      configKey: 'filesystem',
      packages: ['filesystem'],
    }),
    GrpcClientModule.registerAsync({
      name: 'AI_GRPC',
      configKey: 'ai',
      packages: ['ai'],
    }),
    GrpcClientModule.registerAsync({
      name: SERVICES.LEARNING,
      configKey: 'learning',
      packages: ['quizz', 'flashcard', 'todo'],
    }),
  ],
})
export class HandleChatModule {}
