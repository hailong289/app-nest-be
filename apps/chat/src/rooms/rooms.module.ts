import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import messagesModel from 'libs/db/src/mongo/model/messages.model';
import userModel from 'libs/db/src/mongo/model/user.model';
import roomModel from 'libs/db/src/mongo/model/room.model';
import roomEventsModel from 'libs/db/src/mongo/model/room-events.model';
import roomsStateModel from 'libs/db/src/mongo/model/rooms-state.model';
import roomsUsersStateModel from 'libs/db/src/mongo/model/rooms-users-state.model';
import messageReadsModel from 'libs/db/src/mongo/model/message-reads.model';
import messageHidesModel from 'libs/db/src/mongo/model/message-hides.model';
import messageReactionsModel from 'libs/db/src/mongo/model/message-reactions.model';

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
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
