import { Module } from '@nestjs/common';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { SERVICES } from '@app/constants';
import { UserCacheService } from './user-cache.service';

/**
 * CacheModule provides the UserCacheService for two-tier
 * (in-memory LRU + Redis) caching of user info hydrated via
 * the Auth gRPC service.
 *
 * Import this module into any chat sub-module (RoomsModule,
 * HandleChatModule, SocialModule, etc.) that needs cached
 * user lookups.
 *
 * The module registers its own gRPC client to AuthService
 * and reuses the global RedisModule (RedisService).
 */
@Module({
  imports: [
    // gRPC client to Auth service for user info hydration
    GrpcClientModule.registerAsync({
      name: SERVICES.AUTH,
      configKey: 'auth',
      packages: ['auth'],
    }),
  ],
  providers: [UserCacheService],
  exports: [UserCacheService],
})
export class CacheModule {}
