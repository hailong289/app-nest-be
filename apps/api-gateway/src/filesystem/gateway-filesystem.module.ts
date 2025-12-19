import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayService } from '../gateway/gateway.service';
import * as grpc from '@grpc/grpc-js';
import { GatewayFilesystemController } from './gateway-filesystem.controller';
import { GatewayDocumentController } from './docs/gateway-document.controller';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.FILESYSTEM,
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            // Khai báo tên package trong proto file
            package: ['filesystem', 'document'],

            // QUAN TRỌNG: Chỗ này phải là Array trỏ tới 2 file tương ứng
            protoPath: [
              join(process.cwd(), 'libs/grpc/filesystem.proto'),
              join(process.cwd(), 'libs/grpc/document.proto'),
            ],

            url: (() => {
              const hostEnv = (
                process.env.GATEWAY_FILESYSTEM_HOST || ''
              ).trim();
              const isDockerHost = hostEnv?.includes('filesystem');
              const host =
                isDockerHost && process.env.NODE_ENV !== 'production'
                  ? 'localhost'
                  : hostEnv || 'localhost';
              const port = process.env.GATEWAY_FILESYSTEM_PORT || '5002';
              return `${host}:${port}`;
            })(),

            credentials:
              process.env.NODE_ENV === 'production'
                ? grpc.credentials.createSsl()
                : grpc.credentials.createInsecure(),

            loader: {
              keepCase: true,
              longs: String,
              enums: String,
              defaults: true,
              oneofs: true,
              includeDirs: [join(process.cwd(), 'libs/grpc')],
            },
          },
        }),
      },
    ]),
  ],
  controllers: [GatewayFilesystemController, GatewayDocumentController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayFileSystemModule {}
