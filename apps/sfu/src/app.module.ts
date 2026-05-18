import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import path from 'node:path';
import { SfuModule } from './sfu.module';
import { SfuGrpcController } from './sfu-grpc.controller';
import redisConfig from 'libs/db/src/config/redis.config';
import aiConfig from './config/ai.config';
import chatConfig from './config/chat.config';
import transcriptionConfig from './config/transcription.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/sfu/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [redisConfig, aiConfig, chatConfig, transcriptionConfig],
    }),
    SfuModule,
  ],
  controllers: [SfuGrpcController],
})
export class AppModule {}
