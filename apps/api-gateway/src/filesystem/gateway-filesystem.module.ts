import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { join } from 'path';
import { GatewayFilesystemController } from './gateway-filesystem.controller';
import { GatewayService } from '../services/gateway.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: SERVICES.FILESYSTEM,
        transport: Transport.GRPC,
        options: {
          package: 'filesystem',
          protoPath: join(
            process.cwd(),
            process.env.GATEWAY_FILESYSTEM_PROTO_PATH || 'libs/grpc/filesystem.proto',
          ),
          url: `${process.env.GATEWAY_FILESYSTEM_HOST || 'localhost'}:${process.env.GATEWAY_FILESYSTEM_PORT || '5001'}`,
          // credentials: grpc.credentials.createSsl(), // lên cloud run thì phải có dòng này nếu không sẽ bị lỗi UNAVAILABLE: No connection established
        },
      }
    ]),
  ],
  controllers: [GatewayFilesystemController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayFileSystemModule {}