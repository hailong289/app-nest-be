import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KafkaAdminService } from './kafka-admin.service';

@Module({
  imports: [ConfigModule],
  providers: [KafkaAdminService],
  exports: [KafkaAdminService],
})
export class KafkaAdminModule {}
