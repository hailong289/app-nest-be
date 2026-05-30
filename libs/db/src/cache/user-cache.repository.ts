import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { User } from '../mongo/model/user.model';
import { EntityCacheService } from './entity-cache.service';
import { cacheKey } from './cache.keys';

const NS = 'user';

/**
 * Đọc User qua cache 2 tầng. Dùng chung cho auth & chat.
 *
 * QUAN TRỌNG: alias `_id` và `usr_id` chia sẻ cùng reverse-index theo
 * entityId tương ứng. invalidate() dùng `_id` (string) làm entityId
 * canonical — đảm bảo mọi điểm GHI user gọi invalidate(user._id).
 */
@Injectable()
export class UserCacheRepository {
  constructor(
    private readonly cache: EntityCacheService,
    @InjectModel('User') private readonly userModel: Model<User>,
  ) {}

  async getById(id: string): Promise<User | null> {
    return this.cache.getOrLoad<User>(
      cacheKey(NS, '_id', id),
      async () =>
        (await this.userModel
          .findOne({ _id: id })
          .select('-usr_salt')
          .lean()
          .exec()) as User | null,
      { ns: NS, entityId: id },
    );
  }

  async getByUsrId(usrId: string): Promise<User | null> {
    return this.cache.getOrLoad<User>(
      cacheKey(NS, 'usr_id', usrId),
      async () =>
        (await this.userModel
          .findOne({ usr_id: usrId })
          .select('-usr_salt')
          .lean()
          .exec()) as User | null,
      { ns: NS, entityId: usrId },
    );
  }

  /** Gọi sau mỗi lần ghi user (đổi tên/avatar/status...). `id` là user._id. */
  async invalidate(id: string): Promise<void> {
    await this.cache.invalidateEntity(NS, id);
  }
}
