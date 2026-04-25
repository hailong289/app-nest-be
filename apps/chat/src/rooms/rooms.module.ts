import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import { RemoteEmitterModule } from 'libs/ws/src';

import {
  messageHidesModel,
  messageReactionsModel,
  messageReadsModel,
  messagesModel,
  roomEventsModel,
  roomModel,
  roomsStateModel,
  roomsUsersStateModel,
  userModel,
} from 'libs/db/src';

@Module({
  imports: [
    MongooseModule.forFeature([
      messagesModel,
      userModel,
      roomModel,
      roomEventsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messageReadsModel,
      messageHidesModel,
      messageReactionsModel,
    ]),
    RedisModule,
    RemoteEmitterModule,
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
