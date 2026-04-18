import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
import path from 'path';
import { mongoConfig } from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { LearningModule } from './learning/learning.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/learning/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [mongoConfig, kafkaConfig],
    }),
    // KafkaAdminModule,
    MongodbModule,
    LearningModule,
  ],
})
export class AppModule {}
