import { Global, Module } from '@nestjs/common';
import { RedisModule } from 'libs/db/src/redis/redis.module';
import { RemoteSocketEmitter } from './remote-emitter';

/**
 * Global module exposing RemoteSocketEmitter. Import once at the root of any
 * microservice that needs to push Socket.IO events to clients (chat, ai, ...).
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [RemoteSocketEmitter],
  exports: [RemoteSocketEmitter],
})
export class RemoteEmitterModule {}
