import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { MongooseModule } from '@nestjs/mongoose';
import friendshipModel from 'libs/db/src/mongo/model/friendship.model';
import { RoomsModule } from '../rooms/rooms.module';
import roomModel from 'libs/db/src/mongo/model/room.model';
import { SharedKafkaClientModule } from 'libs/kafka';
import { SERVICES } from '@app/constants';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([friendshipModel, roomModel]),
    // Removed: userModel, keysModel — accessed via gRPC
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      clientId: 'chat-social-notification',
      groupId: 'chat-social-notification-group',
    }),
    RoomsModule,
    // gRPC client to Auth service for user info + FCM tokens
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
    // gRPC client to Notification service for push notifications
    GrpcClientModule.registerAsync({
      name: 'NOTIFICATION_GRPC',
      configKey: 'notificationGrpc',
      packages: ['notification'],
    }),
  ],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
