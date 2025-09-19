import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import firebaseConfig from './config/app/firebase.config';
import redisConfig from './config/queue/redis.config';
import { FirebaseService } from './firebase.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [firebaseConfig, redisConfig],
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      useFactory: (configService) => ({
        redis: configService.get('queue.redis'),
      }),
      inject: ['ConfigService'],
    }),
    BullModule.registerQueue({
      name: 'notification',
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationProcessor,
    FirebaseService,
  ],
})
export class AppModule {}