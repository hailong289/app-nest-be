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
} from 'libs/db/src';
import { ROOM_MEMBERSHIP_SYNC_QUEUE } from './room-membership-sync.constants';
import { RoomMembershipSyncProcessor } from './room-membership-sync.processor';
import { RoomCacheRepository } from './room-cache.repository';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';

@Module({
  imports: [
    // Chat-owned models only — userModel removed
    MongooseModule.forFeature([
      messagesModel,
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
    // Queue for bulk USER_ROOMS sAdd when creating large groups / adding many members.
    // Worker processes in batches of 50 to avoid overwhelming the connection pool.
    SharedBullModule.registerQueue(ROOM_MEMBERSHIP_SYNC_QUEUE),
    GatewayClientModule,
  ],
  controllers: [RoomsController],
  providers: [RoomsService, RoomMembershipSyncProcessor, RoomCacheRepository],
  exports: [RoomsService, RoomCacheRepository],
})
export class RoomsModule {}
