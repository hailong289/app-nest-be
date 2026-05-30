import { UserCacheRepository } from './user-cache.repository';
import { cacheKey } from './cache.keys';

describe('UserCacheRepository', () => {
  function makeCacheMock() {
    return {
      getOrLoad: jest.fn(async (_key: string, loader: () => Promise<any>) => loader()),
      invalidateEntity: jest.fn(async () => undefined),
    };
  }

  it('getById loads via cache using the _id alias key', async () => {
    const cache = makeCacheMock();
    const userModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'u1', usr_id: 'usr_x', usr_fullname: 'A' }) }),
      })),
    };
    const repo = new UserCacheRepository(cache as any, userModel as any);

    const out = await repo.getById('u1');

    expect(out).toEqual({ _id: 'u1', usr_id: 'usr_x', usr_fullname: 'A' });
    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('user', '_id', 'u1'),
      expect.any(Function),
      { ns: 'user', entityId: 'u1' },
    );
  });

  it('getByUsrId loads via cache using the usr_id alias key', async () => {
    const cache = makeCacheMock();
    const userModel = {
      findOne: jest.fn(() => ({
        lean: () => ({ exec: async () => ({ _id: 'u1', usr_id: 'usr_x' }) }),
      })),
    };
    const repo = new UserCacheRepository(cache as any, userModel as any);

    await repo.getByUsrId('usr_x');

    expect(cache.getOrLoad).toHaveBeenCalledWith(
      cacheKey('user', 'usr_id', 'usr_x'),
      expect.any(Function),
      { ns: 'user', entityId: 'usr_x' },
    );
  });

  it('invalidate forwards the user _id to the cache service', async () => {
    const cache = makeCacheMock();
    const repo = new UserCacheRepository(cache as any, {} as any);

    await repo.invalidate('u1');

    expect(cache.invalidateEntity).toHaveBeenCalledWith('user', 'u1');
  });
});
