import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import { SERVICES } from '@app/constants/services';
import { SfuRpcClient } from './sfu-rpc.client';
import { UnifiedSignalHandler } from '../unified-signal.handler';

interface SfuClientConfig {
  host: string;
  port: string;
  tls: boolean;
  protoPath: string;
}

/**
 * SfuRpcModule registers a gRPC client to apps/sfu (mediasoup VM).
 * Use in apps/socket (Cloud Run) — pulls in no mediasoup native deps.
 *
 * Usage:
 *   SfuRpcModule.register()
 *
 * Requires `sfu.config.ts` registered via ConfigModule.
 */
@Module({})
export class SfuRpcModule {
  static register(): DynamicModule {
    return {
      module: SfuRpcModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name: SERVICES.SFU,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
              const config = configService.get<SfuClientConfig>('sfu');
              if (!config) {
                throw new Error(
                  'SFU config not found. Make sure sfu.config.ts is loaded into ConfigModule.',
                );
              }

              return {
                transport: Transport.GRPC,
                options: {
                  package: 'sfu',
                  protoPath: join(process.cwd(), config.protoPath),
                  url: `${config.host}:${config.port}`,
                  credentials: config.tls
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
                  channelOptions: {
                    'grpc.keepalive_time_ms': 10000,
                    'grpc.keepalive_timeout_ms': 5000,
                    'grpc.keepalive_permit_without_calls': 1,
                    'grpc.enable_retries': 1,
                  },
                },
              };
            },
          },
        ]),
      ],
      providers: [SfuRpcClient, UnifiedSignalHandler],
      exports: [SfuRpcClient, UnifiedSignalHandler],
    };
  }
}
