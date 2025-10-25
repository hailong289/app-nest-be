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
import mongodbConfig from 'apps/auth/src/config/database/mongodb.config';
import { SocialModule } from './social/social.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/chat/.env'),
      load: [redisConfig, mongodbConfig],
    }),
    MongodbModule,
    RedisModule,
    RoomsModule,
    HandleChatModule,
    SocialModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class AppModule {}
