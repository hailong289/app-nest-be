import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import * as grpc from '@grpc/grpc-js';

export interface GrpcClientConfig {
  host: string;
  port: string;
  protoPath: string | string[];
  nodeEnv: string;
}

export interface GrpcClientOptions {
  name: string; // Token để Inject (VD: SERVICES.CHAT)
  configKey: string; // Key để lấy config từ ConfigService (VD: 'chat')
  packages: string[]; // Packages trong proto (VD: ['chat', 'social'])
}

@Module({})
export class GrpcClientModule {
  static registerAsync(options: GrpcClientOptions): DynamicModule {
    return {
      module: GrpcClientModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name: options.name,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
              const config = configService.get<GrpcClientConfig>(
                options.configKey,
              );

              if (!config) {
                throw new Error(
                  `${options.configKey} config not found! Please import config into ConfigModule.`,
                );
              }

              const protoPath = Array.isArray(config.protoPath)
                ? config.protoPath.map((path) => join(process.cwd(), path))
                : join(process.cwd(), config.protoPath);

              return {
                transport: Transport.GRPC,
                options: {
                  package: options.packages,
                  protoPath,
                  url: `${config.host}:${config.port}`,
                  credentials:
                    config.nodeEnv === 'production'
                      ? grpc.credentials.createSsl()
                      : grpc.credentials.createInsecure(), // local hoặc development
                  loader: {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true,
                    includeDirs: [
                      join(process.cwd(), 'libs/grpc'), // proto files
                      join(process.cwd(), 'libs/grpc'), // để resolve google/protobuf/struct.proto
                    ],
                  },
                  channelOptions: {
                    'grpc.keepalive_time_ms': 10000,
                    'grpc.keepalive_timeout_ms': 5000,
                    'grpc.keepalive_permit_without_calls': 1,
                    'grpc.http2.max_pings_without_data': 0,
                    'grpc.http2.min_time_between_pings_ms': 10000,
                    'grpc.http2.min_ping_interval_without_data_ms': 5000,
                    'grpc.enable_retries': 1,
                    'grpc.service_config': JSON.stringify({
                      methodConfig: [
                        {
                          name: [{}],
                          retryPolicy: {
                            maxAttempts: 5,
                            initialBackoff: '0.1s',
                            maxBackoff: '1s',
                            backoffMultiplier: 2,
                            retryableStatusCodes: [
                              'UNAVAILABLE',
                              'INTERNAL',
                              'UNKNOWN',
                            ],
                          },
                        },
                      ],
                    }),
                  },
                },
              };
            },
          },
        ]),
      ],
      exports: [ClientsModule], // Export ra để service con có thể Inject được ClientProxy
    };
  }
}
