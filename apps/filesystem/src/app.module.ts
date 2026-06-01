import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FilesystemController } from './filesystem.controller';
import { FilesystemService } from './filesystem.service';
import gatewayConfig from './config/gateway.config';
import s3Config from './config/app/s3.config';
import path from 'path';
import { FilesystemDatabaseModule, mongoConfig } from 'libs/db/src';
import { DocumentsModule } from './documents/documents.module';
import { kafkaConfig } from 'libs/kafka';
import { SharedKafkaClientModule } from 'libs/kafka/kafka-client.module';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { SERVICES } from '@app/constants';
import { GatewayClientService } from './gateway-client.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [s3Config, gatewayConfig, mongoConfig, kafkaConfig],
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        'apps/filesystem/.env.development',
      ),
    }),
    FilesystemDatabaseModule,
    DocumentsModule,
    KafkaAdminModule,
    SharedKafkaClientModule.registerAsync({
      name: SERVICES.AI,
      clientId: 'filesystem-ai-client',
      groupId: 'filesystem-ai-group',
    }),
  ],
  controllers: [FilesystemController],
  providers: [FilesystemService, GatewayClientService],
})
export class AppModule {}
