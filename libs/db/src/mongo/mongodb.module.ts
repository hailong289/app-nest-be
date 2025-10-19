import { Global, Logger, Module } from '@nestjs/common';
import mongodbConfig from './configs/mongo.config';

import { ConfigModule, ConfigService } from '@nestjs/config';
import path, { join } from 'path';
import { MongooseModule } from '@nestjs/mongoose';
import messagesModel from './model/messages.model';
import userModel from './model/user.model';
import roomModel from './model/room.model';
import friendshipModel from './model/friendship.model';
import keysModel from './model/keys.model';
import otpModel from './model/otp.model';
import AttachmentModel from './model/Attachment.model';
import roomEventsModel from './model/room-events.model';
import roomsStateModel from './model/rooms-state.model';
import roomsUsersStateModel from './model/rooms-users-state.model';
import messageReadsModel from './model/message-reads.model';
import messageHidesModel from './model/message-hides.model';
import messageReactionsModel from './model/message-reactions.model';
import { cwd } from 'process';
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // thay .env.production nếu có kết nối lên product (tạo thêm file nếu không có)
        join(cwd(), '.env'), // nếu global env có
        join(cwd(), 'apps', 'auth', '.env'),
        join(cwd(), 'apps', 'chat', '.env'),
      ],
      load: [mongodbConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('MongoModule');
        logger.log(`DB_NAME: ${configService.get<string>('DB_NAME')}`);
        const uri = configService.get<string>('mongodb.uri');
        console.log(uri);
        return {
          uri: uri,
          dbName: configService.get<string>('DB_NAME'),
          // Disable sessions/transactions for standalone MongoDB
          autoIndex: true,
          autoCreate: true,
          directConnection: true, // Use direct connection to avoid replica set detection
        };
      },
    }),
    MongooseModule.forFeature([
      messagesModel,
      userModel,
      roomModel,
      friendshipModel,
      keysModel,
      otpModel,
      AttachmentModel,
      roomEventsModel,
      roomsStateModel,
      roomsUsersStateModel,
      messageReadsModel,
      messageHidesModel,
      messageReactionsModel,
    ]),
  ],
  exports: [
    MongooseModule, // quan trọng: export để app con inject Model được
  ],
})
export class MongodbModule {}
