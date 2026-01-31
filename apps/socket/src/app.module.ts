import { Module } from '@nestjs/common';
import { DocWebSocketModule } from './doc/doc.module';
import { ChatWebSocketModule } from './chat/chat.module';
import { WsSharedModule } from 'libs/ws/src/ws.module';
import { ConfigModule } from '@nestjs/config';
import redisConfig from 'libs/db/src/config/redis.config';
import path from 'path';
import { JwtModule } from '@nestjs/jwt';
import { SharedBullModule } from 'libs/db/src';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/socket/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [redisConfig],
    }),
    JwtModule.register({}),
    SharedBullModule.registerAsync(),
    ScheduleModule.forRoot(),
    WsSharedModule,
    ChatWebSocketModule,
    DocWebSocketModule,
  ],
})
export class AppModule {}
