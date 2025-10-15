import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import messagesModel from 'libs/db/src/mongo/model/messages.model';
import userModel from 'libs/db/src/mongo/model/user.model';
import roomModel from 'libs/db/src/mongo/model/room.model';
import eventModel from 'libs/db/src/mongo/model/event.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      messagesModel,
      userModel,
      roomModel,
      eventModel,
    ]),
    RedisModule,
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
