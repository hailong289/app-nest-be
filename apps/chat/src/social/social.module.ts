import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { MongooseModule } from '@nestjs/mongoose';
import friendshipModel from 'libs/db/src/mongo/model/friendship.model';
import userModel from 'libs/db/src/mongo/model/user.model';
import { RoomsService } from '../rooms/rooms.service';
import roomModel from 'libs/db/src/mongo/model/room.model';

@Module({
  imports: [MongooseModule.forFeature([friendshipModel, userModel, roomModel])],
  controllers: [SocialController],
  providers: [SocialService, RoomsService],
  exports: [SocialService],
})
export class SocialModule {}
