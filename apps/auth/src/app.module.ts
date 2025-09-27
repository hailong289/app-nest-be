import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as path from 'path';
import mongodbConfig from './config/database/mongodb.config';
import { JwtModule } from '@nestjs/jwt';
import { User, UserSchema } from './models/user';
import { Key, KeySchema } from './models/keys';

@Module({
  imports: [
    ConfigModule.forRoot({ 
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/auth/.env'),
      load: [mongodbConfig]
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        console.log('Environment Variables:', {
          MONGODB_URI: configService.get<string>('mongodb.uri'),
          DB_NAME: configService.get<string>('DB_NAME'),
        });
        const uri = configService.get<string>('mongodb.uri');
        return { uri: uri, dbName: configService.get<string>('DB_NAME')};
      }
    }),
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Key.name, schema: KeySchema }
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AppModule {}