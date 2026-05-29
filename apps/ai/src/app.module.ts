/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import path from 'path';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { EmbeddingService } from './embedding.service';
import googleConfig from './config/google.config';
import { GoogleModerationProvider } from './google.provider';
import { AiDatabaseModule, mongoConfig } from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { SharedKafkaClientModule } from 'libs/kafka/kafka-client.module';
import { AiLogUseService, AI_KAFKA_CLIENT } from './ai-log-use.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/ai/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [googleConfig, mongoConfig, kafkaConfig],
    }),
    KafkaAdminModule,
    // AiDatabaseModule registers all AI-owned models (aIEmbeddingModel, aIUsageLogModel)
    // plus legacy cross-service reads (userModel, messagesModel, attachmentModel, documentModel).
    // Do NOT add a duplicate MongooseModule.forFeature() here.
    // Legacy models will be removed in Sprint 1 (replace with Kafka payload/snapshot).
    AiDatabaseModule,
    JwtModule.register({}),
    SharedKafkaClientModule.registerAsync({
      name: AI_KAFKA_CLIENT,
      clientId: 'ai-service-producer',
      groupId: 'ai-log-usage-consumer-group',
    }),
  ],
  controllers: [AIController],
  providers: [
    AIService,
    EmbeddingService,
    GoogleModerationProvider,
    AiLogUseService,
  ],
})
export class AppModule {}
