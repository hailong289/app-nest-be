/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
import path from 'path';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import AIUsageLogSchema from 'libs/db/src/mongo/model/AIUsageLogs.model';
import googleConfig from './config/google.config';
('libs/db/src/mongo/model/AIUsageLogs.model');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/ai/.env'),
      load: [googleConfig],
    }),
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([AIUsageLogSchema]),
  ],
  controllers: [AIController],
  providers: [AIService],
})
export class AiModule {}
