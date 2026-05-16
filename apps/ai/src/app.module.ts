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
import Userschema from 'libs/db/src/mongo/model/user.model';
import MessageSchema from 'libs/db/src/mongo/model/messages.model';
import AttachmentSchema from 'libs/db/src/mongo/model/Attachment.model';
import { mongoConfig } from 'libs/db/src';
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
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      AIUsageLogSchema,
      AIEmbeddingSchema,
      Userschema,
      MessageSchema,
      AttachmentSchema,
    ]),
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
