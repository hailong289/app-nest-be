import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { mongooseConfig } from './mongoose.config';
import { MongoDBService } from './mongodb.service';

@Global()
@Module({
  imports: [MongooseModule.forRootAsync(mongooseConfig)],
  providers: [MongoDBService],
  exports: [MongooseModule],
})
export class MongoDBModule {}
