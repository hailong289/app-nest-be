import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as path from 'path';
import mongodbConfig from './config/database/mongodb.config';
import { JwtModule } from '@nestjs/jwt';

import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
import userModel from 'libs/db/src/mongo/model/user.model';
import otpModel from 'libs/db/src/mongo/model/otp.model';
import keysModel from 'libs/db/src/mongo/model/keys.model';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env'),
      load: [mongodbConfig],
    }),
    // MongooseModule.forRootAsync({
    //   inject: [ConfigService],
    //   imports: [ConfigModule],
    //   useFactory: (configService: ConfigService) => {
    //     console.log('Environment Variables:', {
    //       MONGODB_URI: configService.get<string>('mongodb.uri'),
    //       DB_NAME: configService.get<string>('DB_NAME'),
    //     });
    //     const uri = configService.get<string>('mongodb.uri');
    //     return { uri: uri, dbName: configService.get<string>('DB_NAME') };
    //   },
    // }),
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([userModel, otpModel, keysModel]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AppModule {}
