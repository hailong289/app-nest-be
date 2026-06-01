import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RoomsModule } from './rooms/rooms.module';
import { HandleChatModule } from './handle-chat/handle-chat.module';
import path from 'node:path';
import { SocialModule } from './social/social.module';
import redisConfig from 'libs/db/src/config/redis.config';
import {
  ChatDatabaseModule,
  mongoConfig,
  RedisModule,
  CacheModule,
  SharedBullModule,
} from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/chat/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [redisConfig, mongoConfig, kafkaConfig],
    }),
    KafkaAdminModule,
    ChatDatabaseModule,
    RedisModule,
    CacheModule,
    SharedBullModule.registerAsync(),
    RoomsModule,
    HandleChatModule,
    forwardRef(() => SocialModule),
  ],
})
export class AppModule {}
