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

