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
import { EmbeddingService } from './embedding.service';
import AIUsageLogSchema from 'libs/db/src/mongo/model/AIUsageLogs.model';
import googleConfig from './config/google.config';
import { GoogleModerationProvider } from './google.provider';
import AIEmbeddingSchema from 'libs/db/src/mongo/model/AIEmbedding.model';
import { mongoConfig } from 'libs/db/src';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/ai/.env'),
      load: [googleConfig, mongoConfig],
    }),
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([AIUsageLogSchema, AIEmbeddingSchema]),
  ],
  controllers: [AIController],
  providers: [AIService, EmbeddingService, GoogleModerationProvider],
})
export class AppModule {}
