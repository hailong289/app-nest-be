import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DocGateway } from './doc-gateway';
import { GatewayModule } from '../../gateway/gateway.module';
import { join } from 'node:path';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    GatewayModule,
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
  providers: [DocGateway],
  exports: [DocGateway],
})
export class DocWebSocketModule {}
