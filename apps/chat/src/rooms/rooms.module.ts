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
} from 'libs/db/src';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      messagesModel,
      roomModel,
      roomEventsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messageReadsModel,
      messageHidesModel,
      messageReactionsModel,
      // Removed: userModel — user info accessed via gRPC Auth service
    ]),
    RedisModule,
    RemoteEmitterModule,
    // gRPC client to Auth service for user info
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
