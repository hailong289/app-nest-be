import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SERVICES } from '@app/constants';
import { GatewayAuthController } from './gateway-auth.controller';
import { GatewayService } from '../gateway/gateway.service';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import authConfig from '../config/auth.config';

@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
  ],
  controllers: [GatewayAuthController],
  providers: [GatewayService],
})
export class GatewayAuthModule {}
