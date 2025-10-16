import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayAuthController } from './gateway-auth.controller';
import { GatewayService } from '../services/gateway.service';

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
          url: `${process.env.GATEWAY_AUTH_HOST || 'localhost'}:${process.env.GATEWAY_AUTH_PORT || '5001'}`,
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
        },
      }
    ]),
  ],
  controllers: [GatewayAuthController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayAuthModule {}
