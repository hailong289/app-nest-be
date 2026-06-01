import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DocGateway } from './doc-gateway';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
  ],
  providers: [DocGateway],
  exports: [DocGateway],
})
export class DocWebSocketModule {}
