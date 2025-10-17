import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayAuthController } from './gateway-auth.controller';
import { GatewayService } from '../gateway/gateway.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: SERVICES.AUTH,
        transport: Transport.GRPC,
        options: {
          package: 'auth',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_AUTH_PROTO_PATH || 'libs/grpc/auth.proto',
          ),
          url: (() => {
            const hostEnv = (process.env.GATEWAY_AUTH_HOST || '').trim();
            const isDockerHost = hostEnv?.includes('auth');
            const host =
              isDockerHost && process.env.NODE_ENV !== 'production'
                ? 'localhost'
                : hostEnv || 'localhost';
            const port = process.env.GATEWAY_AUTH_PORT || '5001';
            // helpful debug log for name resolution issues
            console.log('Gateway gRPC auth URL:', `${host}:${port}`);
            return `${host}:${port}`;
          })(),
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
          loader: {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: false,
            oneofs: true,
            includeDirs: [
              join(process.cwd(), 'libs/grpc'), // chat.proto
              join(process.cwd(), 'libs/grpc'), // để resolve google/protobuf/struct.proto
            ],
          },
        },
      },
    ]),
  ],
  controllers: [GatewayAuthController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAuthModule {}
