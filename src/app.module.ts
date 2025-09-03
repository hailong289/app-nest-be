import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import redisConfig from './config/queue/redis.config';
import firebaseConfig from './config/app/firebase.config';
import { NotificationModule } from './modules/notification/notification.module';
import { BullModule } from '@nestjs/bull/dist/bull.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, firebaseConfig],
    }),
    NotificationModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
