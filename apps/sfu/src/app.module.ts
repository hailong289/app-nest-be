import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import path from 'node:path';
import { SfuModule } from './sfu.module';
import { SfuGrpcController } from './sfu-grpc.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(
        process.cwd(),
        `apps/sfu/.env.${process.env.NODE_ENV || 'development'}`,
      ),
    }),
    SfuModule,
  ],
  controllers: [SfuGrpcController],
})
export class AppModule {}
