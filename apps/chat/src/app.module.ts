import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RoomsModule } from './rooms/rooms.module';
import { HandleChatModule } from './handle-chat/handle-chat.module';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import path from 'path/win32';
import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
import redisConfig from './config/redis.config';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/chat/.env'),
      load: [redisConfig],
    }),

    // MongooseModule.forRootAsync({
    //   inject: [ConfigService],
    //   imports: [ConfigModule],
    //   useFactory: (configService: ConfigService) => {
    //     console.log('Environment Variables:', {
    //       MONGODB_URI: configService.get<string>('mongodb.uri'),
    //       DB_NAME: configService.get<string>('DB_NAME'),
    //     });
    //     const uri = configService.get<string>('mongodb.uri');
    //     return {
    //       uri: uri,
    //       dbName: configService.get<string>('DB_NAME'),
    //       // Disable sessions/transactions for standalone MongoDB
    //       autoIndex: true,
    //       autoCreate: true,
    //       directConnection: true, // Use direct connection to avoid replica set detection
    //     };
    //   },
    // }),
    MongodbModule,
    RedisModule,
    RoomsModule,
    HandleChatModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class AppModule {}
