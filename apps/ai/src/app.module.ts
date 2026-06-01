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
import gatewayConfig from './config/gateway.config';
import { GoogleModerationProvider } from './google.provider';
import { AiDatabaseModule, mongoConfig } from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { SharedKafkaClientModule } from 'libs/kafka/kafka-client.module';
import { AiLogUseService, AI_KAFKA_CLIENT } from './ai-log-use.service';
import { GatewayClientService } from './gateway-client.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/ai/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [googleConfig, gatewayConfig, mongoConfig, kafkaConfig],
    }),
    KafkaAdminModule,
    // AiDatabaseModule registers only AI-owned models. Keep cross-service
    // data access behind Kafka snapshots or API gateway internal routes.
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
    GatewayClientService,
  ],
})
export class AppModule {}
