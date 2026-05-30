import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Room } from 'libs/db/src';
import { EntityCacheService, cacheKey } from 'libs/db/src';

const NS = 'room';

/**
 * Đọc Room qua cache 2 tầng. Room tra theo room_id (chuỗi), pair id (phòng
 * private), và _id. Mỗi giá trị là một alias key index theo chính nó; vì
 * vậy invalidate(room) xoá cả ba nhánh dựa trên doc.
 */
@Injectable()
export class RoomCacheRepository {
  constructor(
    private readonly cache: EntityCacheService,
    @InjectModel('Room') private readonly roomModel: Model<Room>,
  ) {}

  async getByRoomId(roomId: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, 'room_id', roomId),
      async () =>
        (await this.roomModel.findOne({ room_id: roomId }).lean().exec()) as Room | null,
      {
        ns: NS,
        entityId: roomId,
        indexIds: (room: Room) => [String((room as unknown as { _id: unknown })._id), room.room_id],
      },
    );
  }

  async getByPairOrRoomId(roomId: string, pairId: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, 'room_id', roomId),
      async () =>
        (await this.roomModel
          .findOne({ room_id: { $in: [roomId, pairId] } })
          .lean()
          .exec()) as Room | null,
      {
        ns: NS,
        entityId: roomId,
        indexIds: (room: Room) => [String((room as unknown as { _id: unknown })._id), room.room_id],
      },
    );
  }

  async getById(id: string): Promise<Room | null> {
    return this.cache.getOrLoad<Room>(
      cacheKey(NS, '_id', id),
      async () =>
        (await this.roomModel.findOne({ _id: id }).lean().exec()) as Room | null,
      {
        ns: NS,
        entityId: id,
        indexIds: (room: Room) => [String((room as unknown as { _id: unknown })._id), room.room_id],
      },
    );
  }

  /** Gọi sau mỗi lần ghi room. Xoá mọi nhánh alias dựa trên doc. */
  async invalidate(room: Pick<Room, 'room_id'> & { _id: unknown }): Promise<void> {
    await Promise.all([
      this.cache.invalidateEntity(NS, String((room as { _id: unknown })._id)),
      this.cache.invalidateEntity(NS, room.room_id),
    ]);
  }
}
