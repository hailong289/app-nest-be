import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('MongoModule');
        logger.log(`DB_NAME: ${configService.get<string>('DB_NAME')}`);
        const uri = configService.get<string>('mongodb.uri');
        console.log(uri);
        return {
          uri: uri,
          dbName: configService.get<string>('DB_NAME'),
          // Disable sessions/transactions for standalone MongoDB
          autoIndex: true,
          autoCreate: true,
          directConnection: true, // Use direct connection to avoid replica set detection
        };
      },
    }),
  ],
  exports: [
    MongooseModule, // quan trọng: export để app con inject Model được
  ],
})
export class MongodbModule {}
