import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import firebaseConfig from './config/app/firebase.config';
import mailConfig from './config/app/mail.config';
import { FirebaseService } from './firebase.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import path from 'path';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import appConfig from './config/app/app.config';
import {
  redisConfig,
  RedisModule,
  MongodbModule,
  mongoConfig,
} from 'libs/db/src';
import { kafkaConfig } from 'libs/kafka';
import { KafkaAdminModule } from 'libs/kafka/kafka-admin.module';

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
            logger: false, // Disable transport logger
            debug: false, // Disable debug output
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
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    FirebaseService,
    // Provide Key model for injection
  ],
})
export class AppModule {}
