import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayAuthController } from './gateway-auth.controller';
import { GatewayService } from '../gateway/gateway.service';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.AUTH,
        useFactory: (config: ConfigService) => {
          const isSsl = process.env.NODE_ENV === 'production' ? true : false;
          let options = {
            package: 'auth',
            protoPath: join(
              process.cwd(),
              process.env.GATEWAY_AUTH_PROTO_PATH || 'libs/grpc/auth.proto',
            ),
            url: (() => {
              const host = (process.env.GATEWAY_AUTH_HOST || '').trim();
              const port = process.env.GATEWAY_AUTH_PORT;
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
  controllers: [GatewayAuthController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAuthModule {}
