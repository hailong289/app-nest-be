import { MongooseModuleAsyncOptions } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const mongooseConfig: MongooseModuleAsyncOptions = {
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => {
    console.log('Environment Variables:', {
        MONGODB_URI: configService.get<string>('mongodb.uri'),
        DB_NAME: configService.get<string>('DB_NAME'),
    });
    const uri = configService.get<string>('mongodb.uri');
    return { uri: uri, dbName: configService.get<string>('mongodb.dbName') };
 },
  inject: [ConfigService],
};
