import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import firebaseConfig from './config/app/firebase.config';
import mailConfig from './config/app/mail.config';
import { FirebaseService } from './firebase.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import path from 'path';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import appConfig from './config/app/app.config';
import authConfig from './config/app/auth.config';
import {
  redisConfig,
  RedisModule,
  MongodbModule,
  mongoConfig,
  otpModel,
  notificationModel,
} from 'libs/db/src';
import { MongooseModule } from '@nestjs/mongoose';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/notification/.env.${process.env.NODE_ENV || 'development'}`,
      ),
      load: [
        firebaseConfig,
        mailConfig,
        appConfig,
        authConfig,
        kafkaConfig,
        redisConfig,
        mongoConfig,
      ],
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const mailConfig = {
          transport: {
            host: configService.get<string>('mail.host'),
            port: parseInt(configService.get<string>('mail.port') || '587'),
            secure: false,
            auth: {
              user: configService.get<string>('mail.auth.user'),
              pass: configService.get<string>('mail.auth.pass'),
            },
            logger: false,
            debug: false,
          },
          defaults: {
            from: '"IChat" <no-reply@ichat.com>',
          },
          template: {
            dir: path.resolve(process.cwd(), 'apps/notification/src/templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: false },
          },
        };
        return mailConfig;
      },
    }),
    KafkaAdminModule,
    RedisModule,
    MongodbModule,
    MongooseModule.forFeature([otpModel, notificationModel]),
    // gRPC client to Auth service for FCM token retrieval
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    FirebaseService,
  ],
})
export class AppModule {}
