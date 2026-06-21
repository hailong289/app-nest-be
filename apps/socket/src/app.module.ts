import { Module } from '@nestjs/common';
import { DocWebSocketModule } from './doc/doc.module';
import { ChatWebSocketModule } from './chat/chat.module';
import { CallWebSocketModule } from './call/call.module';
import { WsSharedModule } from './ws';
import { ConfigModule } from '@nestjs/config';
import redisConfig from 'libs/db/src/config/redis.config';
import sfuConfig from './config/sfu.config';
// Kafka config cần cho producer client (Phase 1 CHAT_INGEST_MODE=kafka).
import { kafkaConfig } from 'libs/kafka';
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
      load: [redisConfig, sfuConfig, kafkaConfig],
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
