import { RoomCacheRepository } from './room-cache.repository';
import { cacheKey } from 'libs/db/src';

describe('RoomCacheRepository', () => {
  function makeCacheMock() {
    return {
      getOrLoad: jest.fn(async (_k: string, loader: () => Promise<unknown>) =>
        loader(),
      ),
      invalidateEntity: jest.fn(async () => undefined),
    };
  }

  it('getByRoomId loads via cache using the room_id alias key', async () => {
    const cache = makeCacheMock();
    const roomModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'rid1', room_id: 'r_abc' }) }),
      })),
    };
    const repo = new RoomCacheRepository(cache as any, roomModel as any);

    const out = await repo.getByRoomId('r_abc');

    expect(out).toEqual({ _id: 'rid1', room_id: 'r_abc' });
    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('room', 'room_id', 'r_abc'),
      expect.any(Function),
      expect.objectContaining({ ns: 'room', entityId: 'r_abc' }),
    );
    const passedOpts = (cache.getOrLoad.mock.calls as unknown[][])[0][2] as {
      indexIds: (v: { _id: string; room_id: string }) => string[];
    };
    expect(passedOpts.indexIds({ _id: 'rid1', room_id: 'r_abc' })).toEqual([
      'rid1',
      'r_abc',
    ]);
  });

  it('getByPairOrRoomId queries both room_id and pair id', async () => {
    const cache = makeCacheMock();
    const roomModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'rid1', room_id: 'r_abc' }) }),
      })),
    };
    const repo = new RoomCacheRepository(cache as any, roomModel as any);

    await repo.getByPairOrRoomId('r_abc', 'pair_xy');

    expect(roomModel.findOne).toHaveBeenCalledWith({
      room_id: { $in: ['r_abc', 'pair_xy'] },
    });
  });

  it('invalidate clears room_id, pair-derived and _id branches', async () => {
    const cache = makeCacheMock();
    const repo = new RoomCacheRepository(cache as any, {} as any);

    await repo.invalidate({ _id: 'rid1', room_id: 'r_abc' } as any);

    expect(cache.invalidateEntity).toHaveBeenCalledWith('room', 'rid1');
    expect(cache.invalidateEntity).toHaveBeenCalledWith('room', 'r_abc');
  });
});
