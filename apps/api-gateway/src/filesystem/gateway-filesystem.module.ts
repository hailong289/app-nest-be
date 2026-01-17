import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayService } from '../gateway/gateway.service';
import { GatewayFilesystemController } from './gateway-filesystem.controller';
import { GatewayDocumentController } from './docs/gateway-document.controller';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import filesystemConfig from '../config/filesystem.config';

@Module({
  imports: [
    ConfigModule.forFeature(filesystemConfig),
    GrpcClientModule.registerAsync({
      name: SERVICES.FILESYSTEM,
      configKey: 'filesystem',
      packages: ['filesystem', 'document'],
    }),
  ],
  controllers: [GatewayFilesystemController, GatewayDocumentController],
  providers: [GatewayService],
})
export class GatewayFileSystemModule {}
