import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayFilesystemController } from './gateway-filesystem.controller';
import { GatewayService } from '../gateway/gateway.service';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.FILESYSTEM,
        useFactory: (config: ConfigService) => {
          const isSsl = process.env.NODE_ENV === 'production' ? true : false;
          let options = {
            package: 'filesystem',
            protoPath: join(
              process.cwd(),
              process.env.GATEWAY_FILESYSTEM_PROTO_PATH ||
                'libs/grpc/filesystem.proto',
            ),
            url: (() => {
              const host = (process.env.GATEWAY_FILESYSTEM_HOST || '').trim();
              const port = process.env.GATEWAY_FILESYSTEM_PORT;
              return `${host}:${port}`;
            })(),
            credentials: isSsl
              ? grpc.credentials.createSsl()
              : grpc.credentials.createInsecure(),
          };
          return {
            transport: Transport.GRPC,
            options,
          };
        },
      },
    ]),
  ],
  controllers: [GatewayFilesystemController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayFileSystemModule {}
