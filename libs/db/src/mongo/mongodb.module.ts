import { Global, Module } from '@nestjs/common';
import mongodbConfig from './configs/mongo.config';

import { ConfigModule, ConfigService } from '@nestjs/config';
import path from 'path';
import { MongooseModule } from '@nestjs/mongoose';
import messagesModel from './model/messages.model';
import userModel from './model/user.model';
import roomModel from './model/room.model';
import eventModel from './model/event.model';
import friendshipModel from './model/friendship.model';
import keysModel from './model/keys.model';
import otpModel from './model/otp.model';
import AttachmentModel from './model/Attachment.model';
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), '.env'),
      load: [mongodbConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        console.log('Environment Variables:', {
          MONGODB_URI: configService.get<string>('mongodb.uri'),
          DB_NAME: configService.get<string>('DB_NAME'),
        });
        const uri = configService.get<string>('mongodb.uri');
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
      eventModel,
      friendshipModel,
      keysModel,
      otpModel,
      AttachmentModel,
    ]),
  ],
  exports: [
    MongooseModule, // quan trọng: export để app con inject Model được
  ],
})
export class MongodbModule {}
