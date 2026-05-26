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
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { AiLogUseService } from './ai-log-use.service';
import authConfig from './config/app/auth.config';
import chatConfig from './config/app/chat.config';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/ai/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [googleConfig, mongoConfig, kafkaConfig, authConfig, chatConfig],
    }),
    KafkaAdminModule,
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      AIUsageLogSchema,
      AIEmbeddingSchema,
      // Removed: Userschema, MessageSchema — accessed via gRPC
    ]),
    // gRPC clients for cross-service data access (database isolation)
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat'],
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
