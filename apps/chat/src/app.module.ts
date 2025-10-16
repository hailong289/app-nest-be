import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RoomsModule } from './rooms/rooms.module';
import { HandleChatModule } from './handle-chat/handle-chat.module';
import mongodbConfig from './database/config/mongodb.config';
import redisConfig from './database/config/redis.config';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import path from 'path/win32';
import { MongodbModule } from 'libs/db/src/mongo/mongodb.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), 'apps/chat/.env'),
      load: [mongodbConfig, redisConfig],
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
    //     return {
    //       uri: uri,
    //       dbName: configService.get<string>('DB_NAME'),
    //       // Disable sessions/transactions for standalone MongoDB
    //       autoIndex: true,
    //       autoCreate: true,
    //       directConnection: true, // Use direct connection to avoid replica set detection
    //     };
    //   },
    // }),
    MongodbModule,
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<{
          host: string;
          port: number;
          password?: string;
          keyPrefix?: string;
          ttl?: string;
        }>('redis');
        if (!redis?.host) {
          throw new Error('Redis host is not defined in configuration');
        }
        if (!redis?.port) {
          throw new Error('Redis port is not defined in configuration');
        }
        return {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          keyPrefix: redis.keyPrefix,
          ttl: redis.ttl ?? '3600', // default to 1 hour if not set
        };
      },
    }),
    RoomsModule,
    HandleChatModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class AppModule {}
