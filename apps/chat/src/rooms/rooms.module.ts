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
  SharedBullModule,
  userModel,
} from 'libs/db/src';
import { ROOM_MEMBERSHIP_SYNC_QUEUE } from './room-membership-sync.constants';
import { RoomMembershipSyncProcessor } from './room-membership-sync.processor';

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
    // Queue cho bulk USER_ROOMS sAdd khi tạo group lớn / add nhiều member.
    // Worker xử lý theo lô 50/lần để khỏi đè connection pool.
    SharedBullModule.registerQueue(ROOM_MEMBERSHIP_SYNC_QUEUE),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, RoomMembershipSyncProcessor],
  exports: [RoomsService],
})
export class RoomsModule {}
