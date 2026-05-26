import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as path from 'path';
import { JwtModule } from '@nestjs/jwt';

import userModel from 'libs/db/src/mongo/model/user.model';
import keysModel from 'libs/db/src/mongo/model/keys.model';
import notificationConfig from './config/app/notification.config';
import {
  mongoConfig,
  MongodbModule,
  redisConfig,
  RedisModule,
} from 'libs/db/src';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { SERVICES } from '@app/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env.development'),
      load: [mongoConfig, redisConfig, notificationConfig],
    }),
    RedisModule,
    MongodbModule,
    JwtModule.register({}),
    MongooseModule.forFeature([userModel, keysModel]),
    // gRPC client to Notification service for OTP + push
    GrpcClientModule.registerAsync({
      name: SERVICES.NOTIFICATION,
      configKey: 'notification',
      packages: ['notification'],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AppModule {}
