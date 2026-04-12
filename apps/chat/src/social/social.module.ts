import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { MongooseModule } from '@nestjs/mongoose';
import friendshipModel from 'libs/db/src/mongo/model/friendship.model';
import userModel from 'libs/db/src/mongo/model/user.model';
import { RoomsModule } from '../rooms/rooms.module';
import roomModel from 'libs/db/src/mongo/model/room.model';
import { SharedKafkaClientModule } from 'libs/kafka';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    MongooseModule.forFeature([friendshipModel, userModel, roomModel]),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'chat-social-notification',
      groupId: 'chat-social-notification-group',
    }),
    RoomsModule,
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
