import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { EntityCacheService } from './entity-cache.service';

/**
 * Provide EntityCacheService toàn cục. RedisModule đã @Global nhưng import
 * lại ở đây để CacheModule tự đủ phụ thuộc khi dùng riêng.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [EntityCacheService],
  exports: [EntityCacheService],
})
export class CacheModule {}
