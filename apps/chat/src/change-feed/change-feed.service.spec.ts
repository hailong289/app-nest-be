import { Types } from 'mongoose';
import {
  ChangeFeedService,
  CHANGEFEED_MAX_PER_USER,
} from './change-feed.service';
import { ChangeEventType } from '@app/dto/enum.type';

/**
 * Chain mock cho query Mongoose: mọi method trả về chính nó, `lean()` resolve
 * `result`. Phủ được find/findOne + sort/skip/limit/select/lean.
 */
function queryChain(result: unknown) {
  const obj: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'select']) {
    obj[m] = jest.fn(() => obj);
  }
  obj.lean = jest.fn(() => Promise.resolve(result));
  return obj;
}

type ModelMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  bulkWrite: jest.Mock;
  deleteMany: jest.Mock;
};

function makeService(opts?: {
  find?: unknown;
  findOne?: unknown;
  deleteResult?: { deletedCount?: number };
  currentSeq?: string | null;
  incrValue?: number;
}) {
  const model: ModelMock = {
    find: jest.fn(() => queryChain(opts?.find ?? [])),
    findOne: jest.fn(() => queryChain(opts?.findOne ?? null)),
    bulkWrite: jest.fn(() => Promise.resolve({})),
    deleteMany: jest.fn(() =>
      Promise.resolve(opts?.deleteResult ?? { deletedCount: 0 }),
    ),
  };
  const redis = {
    client: { get: jest.fn(() => Promise.resolve(opts?.currentSeq ?? '0')) },
    incrPersist: jest.fn(() => Promise.resolve(opts?.incrValue ?? 1)),
    sAdd: jest.fn(() => Promise.resolve(1)),
  };
  const chatClient = { emit: jest.fn() };
  const service = new ChangeFeedService(
    model as never,
    chatClient as never,
    redis as never,
  );
  return { service, model, redis };
}

const USER = '507f1f77bcf86cd799439011';
const ROOM = '507f1f77bcf86cd799439012';

describe('ChangeFeedService', () => {
  const ORIGINAL_ENV = process.env.CHANGEFEED_ENABLED;
  afterEach(() => {
    process.env.CHANGEFEED_ENABLED = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  describe('syncEvents', () => {
    it('maps rows, hasMore=false when rows <= limit, nextSeq = last seq', async () => {
      const rows = [
        { seq: 10, type: ChangeEventType.ROOM_READ, room_id: ROOM, payload: { a: 1 } },
        { seq: 11, type: ChangeEventType.MESSAGE_UPDATED, room_id: ROOM, payload: { b: 2 } },
      ];
      const { service } = makeService({ find: rows, currentSeq: '11' });
      const res = await service.syncEvents({ userId: USER, sinceSeq: 0, limit: 200 });

      expect(res.events).toHaveLength(2);
      expect(res.hasMore).toBe(false);
      expect(res.nextSeq).toBe(11);
      expect(res.currentSeq).toBe(11);
      expect(res.requireFullResync).toBe(false);
      // payload serialize JSON
      expect(JSON.parse(res.events[0].payloadJson)).toEqual({ a: 1 });
      expect(res.events[0].type).toBe(ChangeEventType.ROOM_READ);
    });

    it('hasMore=true and trims to limit when rows > limit', async () => {
      const rows = [
        { seq: 1, type: ChangeEventType.ROOM_READ, room_id: ROOM, payload: {} },
        { seq: 2, type: ChangeEventType.ROOM_READ, room_id: ROOM, payload: {} },
        { seq: 3, type: ChangeEventType.ROOM_READ, room_id: ROOM, payload: {} },
      ];
      const { service } = makeService({ find: rows, currentSeq: '3' });
      const res = await service.syncEvents({ userId: USER, sinceSeq: 0, limit: 2 });

      expect(res.hasMore).toBe(true);
      expect(res.events).toHaveLength(2);
      expect(res.nextSeq).toBe(2); // last of the page, not row 3
    });

    it('requireFullResync when cursor older than oldest stored event', async () => {
      const { service } = makeService({
        find: [],
        findOne: { seq: 100 }, // oldest still stored
        currentSeq: '500',
      });
      const res = await service.syncEvents({ userId: USER, sinceSeq: 5, limit: 200 });
      expect(res.requireFullResync).toBe(true);
    });

    it('does NOT require resync when cursor is contiguous with oldest', async () => {
      const { service } = makeService({
        find: [],
        findOne: { seq: 6 }, // oldest = sinceSeq+1 → no gap
        currentSeq: '500',
      });
      const res = await service.syncEvents({ userId: USER, sinceSeq: 5, limit: 200 });
      expect(res.requireFullResync).toBe(false);
    });

    it('never requires resync on first pull (sinceSeq=0)', async () => {
      const { service } = makeService({ find: [], findOne: { seq: 999 } });
      const res = await service.syncEvents({ userId: USER, sinceSeq: 0, limit: 200 });
      expect(res.requireFullResync).toBe(false);
    });
  });

  describe('handleOutboxAppend', () => {
    it('room.newmsgs → upsert HWM with expireAt + marks dirty', async () => {
      const { service, model, redis } = makeService();
      await service.handleOutboxAppend({
        seq: 7,
        type: ChangeEventType.ROOM_NEWMSGS,
        roomId: ROOM,
        recipients: [USER],
        payload: { newestMsgId: 'm1' },
      });

      const ops = model.bulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.upsert).toBe(true);
      expect(ops[0].updateOne.update.$set.seq).toBe(7);
      expect(ops[0].updateOne.update.$set.expireAt).toBeInstanceOf(Date);
      expect(redis.sAdd).toHaveBeenCalledWith(expect.any(String), USER);
    });

    it('non-HWM → insertOne with expireAt', async () => {
      const { service, model } = makeService();
      await service.handleOutboxAppend({
        seq: 8,
        type: ChangeEventType.MESSAGE_UPDATED,
        roomId: ROOM,
        recipients: [USER],
        payload: { msg: {} },
      });
      const ops = model.bulkWrite.mock.calls[0][0];
      expect(ops[0].insertOne.document.seq).toBe(8);
      expect(ops[0].insertOne.document.expireAt).toBeInstanceOf(Date);
    });

    it('no-op when no recipients', async () => {
      const { service, model } = makeService();
      await service.handleOutboxAppend({
        seq: 9,
        type: ChangeEventType.ROOM_READ,
        roomId: ROOM,
        recipients: [],
        payload: {},
      });
      expect(model.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('trimUserToCap', () => {
    it('deletes events at/below the cutoff seq when over cap', async () => {
      const { service, model } = makeService({
        findOne: { seq: 42 },
        deleteResult: { deletedCount: 17 },
      });
      const deleted = await service.trimUserToCap(USER);
      expect(deleted).toBe(17);
      const arg = model.deleteMany.mock.calls[0][0];
      expect(arg.seq).toEqual({ $lte: 42 });
      // skip(cap) applied on the cutoff query
      const chain = model.findOne.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(CHANGEFEED_MAX_PER_USER);
    });

    it('no-op (0) when user has <= cap events', async () => {
      const { service, model } = makeService({ findOne: null });
      const deleted = await service.trimUserToCap(USER);
      expect(deleted).toBe(0);
      expect(model.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('rollout flag', () => {
    it('nextSeq returns 0 and does not INCR when disabled', async () => {
      process.env.CHANGEFEED_ENABLED = 'false';
      const { service, redis } = makeService();
      const seq = await service.nextSeq();
      expect(seq).toBe(0);
      expect(redis.incrPersist).not.toHaveBeenCalled();
    });

    it('emit is a no-op (seq 0) when disabled', async () => {
      process.env.CHANGEFEED_ENABLED = 'false';
      const { service, redis } = makeService();
      const seq = await service.emit({
        type: ChangeEventType.ROOM_READ,
        roomId: ROOM,
        recipients: [USER],
        payload: {},
      });
      expect(seq).toBe(0);
      expect(redis.incrPersist).not.toHaveBeenCalled();
    });
  });
});
