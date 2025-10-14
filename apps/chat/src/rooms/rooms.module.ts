import userModel from 'apps/auth/src/models/user';
import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { MongooseModule } from '@nestjs/mongoose';
import messagesModel from '../database/mongo/model/messages.model';
import roomModel from '../database/mongo/model/room.model';
import eventModel from '../database/mongo/model/event.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      messagesModel,
      userModel,
      roomModel,
      eventModel,
    ]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
