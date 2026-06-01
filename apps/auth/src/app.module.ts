import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { JwtModule } from '@nestjs/jwt';

import {
  AuthDatabaseModule,
  mongoConfig,
  redisConfig,
  RedisModule,
  CacheModule,
  UserCacheRepository,
} from 'libs/db/src';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env.development'),
      load: [mongoConfig, redisConfig],
    }),
    RedisModule,
    // AuthDatabaseModule registers userModel, otpModel, keysModel via MongooseModule.forFeature().
    // Do NOT add a duplicate MongooseModule.forFeature() here — models are already available
    // to all injected services through AuthDatabaseModule's global scope.
    AuthDatabaseModule,
    CacheModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserCacheRepository],
})
export class AppModule {}
