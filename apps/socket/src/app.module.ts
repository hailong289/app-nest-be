import { Module } from '@nestjs/common';
import { DocWebSocketModule } from './doc/doc.module';
import { ChatWebSocketModule } from './chat/chat.module';
import { CallWebSocketModule } from './call/call.module';
import { WsSharedModule } from './ws';
import { ConfigModule } from '@nestjs/config';
import redisConfig from 'libs/db/src/config/redis.config';
import sfuConfig from './config/sfu.config';
import path from 'path';
import { JwtModule } from '@nestjs/jwt';
import { SharedBullModule } from 'libs/db/src/bull/bull.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(
          process.cwd(),
          `apps/socket/.env.${process.env.NODE_ENV || 'development'}`,
        ),
        path.resolve(process.cwd(), 'apps/socket/.env'),
      ],
      load: [redisConfig, sfuConfig],
    }),
    JwtModule.register({}),
    SharedBullModule.registerAsync(),
    ScheduleModule.forRoot(),
    WsSharedModule,
    ChatWebSocketModule,
    CallWebSocketModule,
    DocWebSocketModule,
  ],
})
export class AppModule {}
