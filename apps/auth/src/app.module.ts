import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as path from 'path';
import mongodbConfig from './config/database/mongodb.config';
import { JwtModule } from '@nestjs/jwt';
import { MongoDBModule } from 'libs/database/src/mongodb/mongodb.module';
import userSchema from 'libs/schemas/src/user.schema';
import keysSchema from 'libs/schemas/src/keys.schema';
import otpSchema from 'libs/schemas/src/otp.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env'),
      load: [mongodbConfig],
    }),
    MongoDBModule,
    MongooseModule.forFeature([
       userSchema,
       keysSchema,
       otpSchema
    ]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AppModule {}
