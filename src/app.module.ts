import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import redisConfig from './config/queue/redis.config';
import firebaseConfig from './config/app/firebase.config';
import s3Config from './config/app/s3.config';
import { NotificationModule } from './modules/notification/notification.module';
import { FileSystemModule } from './modules/filesystem/filesystem.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, firebaseConfig, s3Config],
    }),
    NotificationModule,
    FileSystemModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
