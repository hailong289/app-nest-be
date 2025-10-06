import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import firebaseConfig from './config/app/firebase.config';
import redisConfig from './config/queue/redis.config';
import mailConfig from './config/app/mail.config';
import { FirebaseService } from './firebase.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import path from 'path';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/notification/.env'),
      load: [firebaseConfig, redisConfig, mailConfig]
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const mailConfig = {
          transport: {
            host: configService.get<string>('mail.host'),
            port: parseInt(configService.get<string>('mail.port') || '587'),
            secure: false,
            auth: {
              user: configService.get<string>('mail.auth.user'),
              pass: configService.get<string>('mail.auth.pass'),
            },
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
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    FirebaseService,
  ],
})
export class AppModule {}