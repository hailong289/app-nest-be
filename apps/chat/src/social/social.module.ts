import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { MongooseModule } from '@nestjs/mongoose';
import friendshipModel from 'libs/db/src/mongo/model/friendship.model';
import { RoomsModule } from '../rooms/rooms.module';
import { SharedKafkaClientModule } from 'libs/kafka';
import { SERVICES } from '@app/constants';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';

@Module({
  imports: [
    // Only chat-owned models: Friendships
    MongooseModule.forFeature([friendshipModel]),
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'chat-social-notification',
      groupId: 'chat-social-notification-group',
    }),
    RoomsModule,
    GatewayClientModule,
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
