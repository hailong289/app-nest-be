import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as path from 'path';
import { JwtModule } from '@nestjs/jwt';

import userModel from 'libs/db/src/mongo/model/user.model';
import otpModel from 'libs/db/src/mongo/model/otp.model';
import keysModel from 'libs/db/src/mongo/model/keys.model';
import {
  AuthDatabaseModule,
  mongoConfig,
  redisConfig,
  RedisModule,
} from 'libs/db/src';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env.development'),
      load: [mongoConfig, redisConfig],
    }),
    RedisModule,
    AuthDatabaseModule,
    JwtModule.register({}),
    MongooseModule.forFeature([userModel, otpModel, keysModel]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AppModule {}
