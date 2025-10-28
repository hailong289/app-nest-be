import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RoomsModule } from './rooms/rooms.module';
import { HandleChatModule } from './handle-chat/handle-chat.module';
import path from 'node:path';
import { SocialModule } from './social/social.module';
import redisConfig from 'libs/db/src/config/redis.config';
import { mongoConfig, MongodbModule, RedisModule } from 'libs/db/src';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/chat/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [redisConfig, mongoConfig],
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
