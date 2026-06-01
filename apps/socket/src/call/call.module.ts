import { Module } from '@nestjs/common';
import { CallGateway } from './call.gateway';
import { SfuRpcModule } from '@app/sfu';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SharedBullModule } from 'libs/db/src/bull/bull.module';
import { CALL_AUTO_MISS_QUEUE } from './call-auto-miss.constants';
import { CallAutoMissProcessor } from './call-auto-miss.processor';

@Module({
  imports: [
    // SFU operations are delegated via gRPC to apps/sfu (mediasoup VM).
    // No mediasoup native binary is loaded in this app (Cloud Run friendly).
    SfuRpcModule.register(),
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
    // Distributed delayed-job queue for the server-side auto-miss timer.
    // Replaces in-process setTimeout so the timer survives pod restarts
    // and is safe under multi-pod Cloud Run autoscale.
    SharedBullModule.registerQueue(CALL_AUTO_MISS_QUEUE),
  ],
  providers: [CallGateway, CallAutoMissProcessor],
  exports: [CallGateway],
})
export class CallWebSocketModule {}
