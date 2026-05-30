import {
  ChangeNickNameMemberDto,
  ChangeRoleMemberDto,
  CreateRoomEvent,
  DeletedRoomDto,
  GetRoomDto,
  MutedRoomDto,
  PinnedRoomDto,
} from './../../../../libs/dto/src/room.dto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import Utils from '@app/helpers/utils';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import {
  AddMemberRoomDto,
  ChangelinkAvatarRoomDto,
  ChangeNameRoomDto,
  CreateRoomDto,
  GetRoomType,
  LeavingRoomDto,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';
import removeAccents from 'remove-accents'; // npm i remove-accents
import {
  memberType,
  Message,
  Room,
  RoomEvent,
  User,
  RoomsUsersState,
  UserCacheRepository,
} from 'libs/db/src';
import { RemoteSocketEmitter } from 'libs/ws/src';
import { RoomCacheRepository } from './room-cache.repository';
import { socketEvent } from 'libs/dto/src/enum.type';
import { buildMessageDetailPipeline } from '../handle-chat/Pipeline/getMsg';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  ROOM_MEMBERSHIP_SYNC_QUEUE,
  type RoomMembershipSyncJobData,
} from './room-membership-sync.constants';

@Injectable()
export class RoomsService {
  private readonly utils = Utils;
  private readonly key = REDISKEY;
  private readonly log = new Logger();
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(RoomEvent.name) private readonly roomEvent: Model<RoomEvent>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    private readonly redis: RedisService,
    @InjectModel(RoomsUsersState.name)
    private readonly RoomsUsersState: Model<RoomsUsersState>,
    private readonly emitter: RemoteSocketEmitter,
    @InjectQueue(ROOM_MEMBERSHIP_SYNC_QUEUE)
    private readonly membershipSyncQueue: Queue<RoomMembershipSyncJobData>,
    private readonly userCache: UserCacheRepository,
    private readonly roomCache: RoomCacheRepository,
  ) {}

  async onModuleInit() {
    await this.syncAllUserRoomsToRedis();
  }

  /**
   * Đồng bộ lại tất cả các phòng của user vào Redis khi khởi động service.
   * Điều này đảm bảo tính nhất quán dữ liệu cho tính năng 'tham gia phòng mặc định'.
   */
  async syncAllUserRoomsToRedis() {
    this.log.log('🔄 Bắt đầu đồng bộ User Rooms từ DB sang Redis...');
    try {
      interface UserRoomsAgg {
        _id: Types.ObjectId;
        rooms: string[];
      }

      // 1. Group tất cả Rooms theo thành viên để lấy danh sách room_id (custom string)
      const cursor = this.roomModel
        .aggregate<UserRoomsAgg>([
          { $unwind: '$room_members' },
          {
            $group: {
              _id: '$room_members.user_id',
              rooms: { $push: '$room_id' },
            },
          },
        ])
        .cursor();

      let count = 0;
      // 2. Duyệt qua từng user và push vào Redis
      for await (const uDoc of cursor) {
        const doc = uDoc as UserRoomsAgg;
        if (doc._id && doc.rooms && doc.rooms.length > 0) {
          const userId = doc._id.toString();
          // doc.rooms lúc này là mảng các room_id (string)
          const roomIds: string[] = doc.rooms;
          const key = this.key.USER_ROOMS(userId);

          // Xóa set cũ để đảm bảo sạch sẽ
          await this.redis.delKey(key);
          await this.redis.sAdd(key, ...roomIds);
          count++;
        }
      }
      this.log.log(`✅ Đồng bộ hoàn tất: Đã update rooms cho ${count} users.`);
    } catch (error) {
      this.log.error('❌ Lỗi khi đồng bộ User Rooms:', error);
    }
  }

  /**
   * Persist a room event AND broadcast it to clients in real time.
   *
   * Pipeline:
   *   1. Insert a system Message (msg_type='system') with the event placeholder
   *      so the FE shows it inline in the chat thread.
   *   2. Insert a RoomEvent linked to that message via `message_id`.
   *   3. Update room.room_lastMessage so room previews render the system msg.
   *   4. Emit two Socket.IO events to the room (via Redis pub/sub from libs/ws):
   *        - 'message:upsert' (the system message itself)
   *        - 'room:update'    ({ roomId, messageId, eventId, eventType, payload })
   *
   * Replaces the old writeLogRoom() + emitRoomUpdate() + Bull queue duo.
   */
  async writeLogRoom(input: CreateRoomEvent) {
    // 1. system Message
    const systemMsg = await this.messageModel.create({
      msg_roomId: input.room_id,
      msg_sender: input.actor_id ?? null,
      msg_type: 'system',
      msg_content: input.placeholder,
      placeholder: input.placeholder,
    });

    // 2. RoomEvent linked to system message
    const event = await this.roomEvent.create({
      ...input,
      message_id: systemMsg._id,
    });

    // 3. Update room.room_lastMessage (best-effort, don't fail the whole flow)
    try {
      await this.roomModel.updateOne(
        { _id: input.room_id },
        { $set: { room_lastMessage: systemMsg._id } },
      );
    } catch (err) {
      this.log.warn(
        `[ROOM_EVENT] Failed to update room_lastMessage for ${String(input.room_id)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 4. Resolve the room's custom string id (used as Socket.IO room name)
    const room = await this.roomModel
      .findById(input.room_id, { room_id: 1 })
      .lean<{ room_id: string }>();

    if (!room?.room_id) {
      this.log.warn(
        `[ROOM_EVENT] Room ${String(input.room_id)} not found, skipping socket emit`,
      );
      return event;
    }

    // 5. Hydrate the system message through the same pipeline FE uses for
    //    regular messages so it carries `room_event` (event_type, actor,
    //    targets, payload). FE renders it via <SystemMessageBubble />.
    // `messagePayload: unknown` thay vì `Record<string, unknown>` để khớp
    // ngay với `toObject()` (Mongoose doc class không có index signature)
    // và signature `broadcastTo(...args: unknown[])` — bỏ được mọi cast.
    let messagePayload: unknown;
    try {
      const hydrated: Record<string, unknown> | undefined = (
        await this.messageModel.aggregate<Record<string, unknown>>(
          buildMessageDetailPipeline(systemMsg._id.toString()),
        )
      )[0];
      messagePayload = hydrated ?? systemMsg.toObject();
    } catch (err) {
      this.log.warn(
        `[ROOM_EVENT] Pipeline hydration failed for ${String(systemMsg._id)}: ${
          err instanceof Error ? err.message : String(err)
        } — emitting raw doc instead`,
      );
      messagePayload = systemMsg.toObject();
    }

    // 6. Broadcast via Redis-backed emitter (apps/socket relays to clients)
    const namespace = '/chat';
    this.emitter.broadcastTo(
      namespace,
      room.room_id,
      socketEvent.MSGUPSERT,
      messagePayload,
    );
    this.emitter.broadcastTo(namespace, room.room_id, 'room:update', {
      roomId: room.room_id,
      messageId: String(systemMsg._id),
      eventId: event.event_id,
      eventType: input.event_type,
      payload: input.payload ?? {},
    });

    return event;
  }

  /**
   * Lightweight room notification — emits 'room:update' only (no system
   * message, no RoomEvent). Use for changes that already produce their own
   * surface event, e.g. pinning a message: the FE already gets the pin event,
   * we just need to nudge the room metadata (last activity, pinned list).
   */
  notifyRoomChanged(
    roomIdString: string,
    payload: Record<string, unknown> = {},
  ): void {
    if (!roomIdString) return;
    this.emitter.broadcastTo('/chat', roomIdString, 'room:update', {
      roomId: roomIdString,
      eventType: 'room.refresh',
      payload,
    });
  }

  private handlePipeline(userId: string): PipelineStage[] {
    const uid = this.utils.convertToObjectIdMongoose(userId);

    const pipeline: PipelineStage[] = [
      /** 1) Chỉ các phòng mà tôi là member */
      { $match: { 'room_members.user_id': uid } },
      /** 1.1) Lấy usr_id của user hiện tại */
      {
        $lookup: {
          from: 'Users',
          localField: 'room_members.user_id', // nhưng lọc đúng user hiện tại
          foreignField: '_id',
          pipeline: [
            { $match: { _id: uid } },
            { $project: { _id: 1, usr_id: 1 } },
          ],
          as: 'currentUserInfo',
        },
      },
      { $set: { currentUserInfo: { $first: '$currentUserInfo' } } },

      /** 2) Map info user vào room_members (1 lookup) */
      {
        $lookup: {
          from: 'Users',
          localField: 'room_members.user_id',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, usr_fullname: 1, usr_avatar: 1 } }],
          as: 'membersInfo',
        },
      },
      {
        $addFields: {
          members: {
            $map: {
              input: '$room_members',
              as: 'm',
              in: {
                $let: {
                  vars: {
                    u: {
                      $first: {
                        $filter: {
                          input: '$membersInfo',
                          as: 'u',
                          cond: { $eq: ['$$u._id', '$$m.user_id'] },
                        },
                      },
                    },
                  },
                  in: {
                    $mergeObjects: [
                      '$$m', // giữ nguyên toàn bộ dữ liệu gốc của member
                      {
                        avatar: '$$u.usr_avatar', // chỉ cập nhật/ghi đè field avatar
                        name: {
                          $cond: [
                            {
                              $or: [
                                { $not: ['$$m.name'] },
                                { $eq: ['$$m.name', ''] },
                              ],
                            },
                            '$$u.usr_fullname',
                            '$$m.name',
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      { $unset: 'membersInfo' },

      /** 3) RoomsState (theo ObjectId) */
      {
        $lookup: {
          from: 'RoomsState',
          localField: '_id', // Room._id
          foreignField: 'room_id', // RoomsState.room_id
          as: 'state',
        },
      },
      { $set: { state: { $first: '$state' } } },
      /** 🔥 NEW: Lookup RoomEvents → build timeline cho từng phòng */
      {
        $lookup: {
          from: 'RoomEvents', // đúng theo collection trong schema
          localField: '_id', // _id của Room
          foreignField: 'room_id', // ref trong RoomEvent
          pipeline: [
            // Mới nhất trước
            { $sort: { createdAt: -1 } },
            // Tuỳ ông muốn limit bao nhiêu event
            // { $limit: 20 },
            {
              $project: {
                _id: 0,
                id: '$_id',
                // date: "YYYY-MM"
                timestamp: '$createdAt',

                // title: ưu tiên payload.title → fallback placeholder → event_type
                title: {
                  $ifNull: [
                    '$payload.title',
                    {
                      $ifNull: ['$placeholder', '$event_type'],
                    },
                  ],
                },

                // description: ưu tiên payload.description → fallback event_type
                description: {
                  $ifNull: ['$payload.description', '$event_type'],
                },

                // status: ưu tiên payload.status → nếu không có thì map theo event_type
                status: {
                  $ifNull: [
                    '$payload.status',
                    {
                      $switch: {
                        branches: [
                          {
                            // join/create/add → success
                            case: {
                              $in: [
                                '$event_type',
                                [
                                  'member.joined',
                                  'member.added',
                                  'member.create',
                                ],
                              ],
                            },
                            then: 'success',
                          },
                          {
                            // left / deleted → danger
                            case: {
                              $in: [
                                '$event_type',
                                ['member.left', 'member.deleted'],
                              ],
                            },
                            then: 'danger',
                          },
                          {
                            // đổi tên, đổi avatar, đổi role → info
                            case: {
                              $in: [
                                '$event_type',
                                [
                                  'member.edit',
                                  'member.change.name',
                                  'member.change.avatar',
                                  'member.change.nickName',
                                  'member.change.role',
                                ],
                              ],
                            },
                            then: 'info',
                          },
                        ],
                        default: 'default',
                      },
                    },
                  ],
                },
              },
            },
          ],
          as: 'roomEvents', // field mới trong Room
        },
      },
      /** 4) last_message_doc & sender */
      {
        $lookup: {
          from: 'Messages',
          localField: 'state.last_message_id',
          foreignField: '_id',
          as: 'last_message_doc',
        },
      },
      { $set: { last_message_doc: { $first: '$last_message_doc' } } },
      {
        $lookup: {
          from: 'Users',
          let: {
            sid: {
              $ifNull: [
                '$state.last_message_snapshot.sender_id',
                '$last_message_doc.msg_sender',
              ],
            },
          },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$sid'] } } },
            { $project: { _id: 1, usr_id: 1, usr_fullname: 1, usr_avatar: 1 } },
          ],
          as: 'last_message_sender',
        },
      },
      { $set: { last_message_sender: { $first: '$last_message_sender' } } },

      /** 5) RoomsUsersState của tôi */
      {
        $lookup: {
          from: 'RoomsUsersState',
          let: { rid: '$_id', uid: uid },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$room_id', '$$rid'] },
                    { $eq: ['$user_id', '$$uid'] },
                  ],
                },
              },
            },
            { $limit: 1 },
            {
              $project: {
                last_read_at: 1,
                clear_before_ts: 1,
                last_read_msg_id: 1,
                unread_count: 1,
                muted: 1,
                pinned: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          as: 'my_state',
        },
      },
      { $set: { my_state: { $first: '$my_state' } } },

      /** 6) Tính lastMsgTs & lastMsgSender (doc ưu tiên snapshot fallback cả 2 chiều) */
      {
        $addFields: {
          _lastMsgTs: {
            $ifNull: [
              '$last_message_doc.createdAt',
              '$state.last_message_snapshot.createdAt',
            ],
          },
          _lastMsgSender: {
            $ifNull: [
              '$last_message_doc.msg_sender',
              '$state.last_message_snapshot.sender_id',
            ],
          },
        },
      },

      /** 7) Read receipt cho chính last message */
      {
        $lookup: {
          from: 'MessageReads',
          let: { lm: '$state.last_message_id', uid: uid },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_id', '$$lm'] },
                    { $eq: ['$user_id', '$$uid'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'my_lastmsg_read',
        },
      },
      { $set: { my_lastmsg_read: { $first: '$my_lastmsg_read' } } },

      /** 8) is_read: no last → true; mine → true; has receipt → true; lastMsgTs <= last_read_at → true */
      {
        $addFields: {
          is_read: {
            $cond: [
              { $not: ['$state.last_message_id'] },
              true,
              {
                $or: [
                  { $eq: ['$_lastMsgSender', uid] },
                  { $ifNull: ['$my_lastmsg_read._id', false] },
                  {
                    $and: [
                      { $ifNull: ['$my_state.last_read_at', false] },
                      { $lte: ['$_lastMsgTs', '$my_state.last_read_at'] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      /** 9) unread_count_calc: baseTs = max(last_read_at, clear_before_ts) */
      {
        $addFields: {
          _baseTs: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $ifNull: ['$my_state.last_read_at', false] },
                      { $ifNull: ['$my_state.clear_before_ts', false] },
                      {
                        $gt: [
                          '$my_state.last_read_at',
                          '$my_state.clear_before_ts',
                        ],
                      },
                    ],
                  },
                  then: '$my_state.last_read_at',
                },
                {
                  case: {
                    $and: [
                      { $ifNull: ['$my_state.last_read_at', false] },
                      { $ifNull: ['$my_state.clear_before_ts', false] },
                      {
                        $lte: [
                          '$my_state.last_read_at',
                          '$my_state.clear_before_ts',
                        ],
                      },
                    ],
                  },
                  then: '$my_state.clear_before_ts',
                },
              ],
              default: {
                $ifNull: [
                  '$my_state.last_read_at',
                  '$my_state.clear_before_ts',
                ],
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: 'Messages',
          let: { rid: '$_id', uid: uid, baseTs: '$_baseTs' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_roomId', '$$rid'] },
                    { $ne: ['$msg_sender', '$$uid'] },
                    {
                      $or: [
                        { $eq: ['$deletedAt', null] },
                        { $not: ['$deletedAt'] },
                      ],
                    },
                    {
                      $cond: [
                        { $ifNull: ['$$baseTs', false] },
                        { $gt: ['$createdAt', '$$baseTs'] },
                        true,
                      ],
                    },
                  ],
                },
              },
            },
            { $count: 'cnt' },
          ],
          as: 'unread',
        },
      },
      {
        $set: {
          unread_count_calc: { $ifNull: [{ $first: '$unread.cnt' }, 0] },
        },
      },
      { $unset: ['unread', '_baseTs', '_lastMsgTs', '_lastMsgSender'] },

      /** 10) Avatar & tên hiển thị (private fallback) */
      {
        $addFields: {
          _hasAvatar: { $ne: [{ $ifNull: ['$room_avatar', ''] }, ''] },
          otherMember: {
            $cond: [
              {
                $and: [
                  { $eq: ['$room_type', 'private'] },
                  { $not: ['$_hasAvatar'] },
                ],
              },
              {
                $first: {
                  $filter: {
                    input: '$members',
                    as: 'm',
                    cond: { $ne: ['$$m.user_id', uid] },
                  },
                },
              },
              '$$REMOVE',
            ],
          },
          groupAvatars: {
            $cond: [
              {
                $and: [
                  { $eq: ['$room_type', 'group'] },
                  { $not: ['$_hasAvatar'] },
                ],
              },
              {
                $slice: [
                  { $map: { input: '$members', as: 'm', in: '$$m.avatar' } },
                  4,
                ],
              },
              '$$REMOVE',
            ],
          },
        },
      },

      /** 11) Sort key: last_message_doc.createdAt → snapshot.createdAt → state.updatedAt → room.updatedAt */
      {
        $addFields: {
          _lastTs: {
            $ifNull: [
              '$last_message_doc.createdAt',
              {
                $ifNull: [
                  '$state.last_message_snapshot.createdAt',
                  { $ifNull: ['$state.updatedAt', '$updatedAt'] },
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          _lastMsgVisible: {
            $cond: [
              { $ifNull: ['$my_state.clear_before_ts', false] },
              { $gt: ['$_lastMsgTs', '$my_state.clear_before_ts'] },
              true,
            ],
          },
        },
      },
      { $sort: { _lastTs: -1 } },
      /** 11.1) Pinned messages của room */
      {
        $lookup: {
          from: 'Messages',
          let: {
            pins: '$room_ghim',
            uid: uid,
            clearBefore: '$my_state.clear_before_ts',
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$_id', '$$pins'] },
                    {
                      $cond: [
                        { $ifNull: ['$$clearBefore', false] },
                        { $gt: ['$createdAt', '$$clearBefore'] },
                        true,
                      ],
                    },
                    // KHÔNG lọc deleted để giữ đồng bộ trạng thái — UI đọc isDeleted để quyết
                    // Nếu muốn ẩn hẳn msg đã xoá, thêm bộ lọc deletedAt tại đây.
                  ],
                },
              },
            },

            // === Map trạng thái ẩn theo từng tin nhắn cho chính user ===
            {
              $lookup: {
                from: 'MessageHides',
                let: { mid: '$_id', uid: '$$uid' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$msg_id', '$$mid'] },
                          { $eq: ['$user_id', '$$uid'] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                  { $project: { _id: 0, hiddenAt: 1 } },
                ],
                as: 'hide',
              },
            },
            { $set: { hide: { $first: '$hide' } } },

            // === Project ra cho UI ===
            {
              $project: {
                id: '$_id',
                type: '$msg_type',
                content: '$msg_content',
                createdAt: '$createdAt',

                // cờ xoá theo message
                isDeleted: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$deletedAt', null] },
                        { $not: ['$deletedAt'] },
                      ],
                    },
                    false,
                    true,
                  ],
                },

                // trạng thái ẩn theo từng message (đúng yêu cầu)
                hiddenByMe: {
                  $cond: [{ $ifNull: ['$hide.hiddenAt', false] }, true, false],
                },
                hiddenAt: {
                  $cond: [
                    { $ifNull: ['$hide.hiddenAt', false] },
                    { $toString: '$hide.hiddenAt' },
                    null,
                  ],
                },

                // (tuỳ chọn) nếu UI cần người gửi:
                // sender: '$msg_sender',
              },
            },
            { $match: { hiddenByMe: false } },
            {
              $match: {
                isDeleted: false,
              },
            },
            { $sort: { createdAt: -1 } },
          ],
          as: 'pinned_messages',
        },
      },

      {
        $addFields: {
          pinned_count: {
            $cond: {
              if: { $isArray: '$room_ghim' },
              then: { $size: '$room_ghim' },
              else: 0,
            },
          },
        },
      },
      /** Friendship state cho private room (block) */
      {
        $lookup: {
          from: 'Friendships',
          let: { rid: '$room_id', myUsrId: '$currentUserInfo.usr_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$frp_id', '$$rid'] },
                    {
                      $or: [
                        { $eq: ['$frp_userId1', '$$myUsrId'] },
                        { $eq: ['$frp_userId2', '$$myUsrId'] },
                      ],
                    },
                  ],
                },
              },
            },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                frp_status: 1,
                frp_userId1: 1,
                frp_userId2: 1,
                frp_actionUserId: 1,
              },
            },
          ],
          as: 'friendship',
        },
      },
      { $set: { friendship: { $first: '$friendship' } } },

      /** xác định block flags */
      {
        $addFields: {
          isBlocked: {
            $cond: [
              {
                $and: [
                  { $eq: ['$room_type', 'private'] },
                  { $eq: ['$friendship.frp_status', 'BLOCKED'] },
                ],
              },
              true,
              false,
            ],
          },

          /** isBlocked = true && tôi là người block */
          blockByMine: {
            $cond: [
              {
                $and: [
                  { $eq: ['$room_type', 'private'] },
                  { $eq: ['$friendship.frp_status', 'BLOCKED'] },
                  {
                    $eq: [
                      '$friendship.frp_actionUserId',
                      '$currentUserInfo.usr_id',
                    ],
                  },
                ],
              },
              true,
              false,
            ],
          },
        },
      },

      /** 12) Project output gọn cho UI */
      {
        $project: {
          _id: 1,

          id: {
            $cond: [
              { $eq: ['$room_type', 'private'] },
              '$otherMember.id',
              '$room_id',
            ],
          },
          roomId: '$room_id',
          _mongoId: '$_id',
          type: '$room_type',
          updatedAt: '$_lastTs',

          name: {
            $cond: [
              { $eq: ['$room_type', 'private'] },
              '$otherMember.name',
              '$room_name',
            ],
          },
          avatar: {
            $cond: [
              { $eq: ['$_hasAvatar', true] },
              '$room_avatar',
              {
                $cond: [
                  { $eq: ['$room_type', 'private'] },
                  '$otherMember.avatar',
                  { $arrayElemAt: ['$groupAvatars', 0] },
                ],
              },
            ],
          },
          members: 1,

          last_message: {
            $cond: [
              '$_lastMsgVisible',
              {
                id: '$state.last_message_id',
                content: '$state.last_message_snapshot.content',
                createdAt: {
                  $ifNull: [
                    '$last_message_doc.createdAt',
                    '$state.last_message_snapshot.createdAt',
                  ],
                },
                sender: {
                  _id: '$last_message_sender._id',
                  id: '$last_message_sender.usr_id',
                  name: '$last_message_sender.usr_fullname',
                  avatar: '$last_message_sender.usr_avatar',
                },
                isMine: { $eq: ['$last_message_sender._id', uid] },
              },
              {
                id: null,
                content: null,
                createdAt: null,
                sender: {
                  _id: null,
                  id: null,
                  name: null,
                  avatar: null,
                },
                isMine: false,
              },
            ],
          },

          is_read: 1,
          unread_count: {
            $ifNull: ['$my_state.unread_count', '$unread_count_calc'],
          },
          my_state: 1,
          last_read_id: {
            $toString: '$my_state.last_read_msg_id',
          },
          pinned: '$my_state.pinned',
          muted: '$my_state.muted',
          pinned_messages: 1,
          pinned_count: 1,
          isBlocked: 1,
          blockByMine: 1,
          roomEvents: 1,
        },
      },
    ];

    return pipeline;
  }

  public async getUserInfo(
    userId: string,
  ): Promise<(User & { _id: Types.ObjectId }) | null> {
    const user = await this.userCache.getById(userId);
    // Giữ nguyên hợp đồng cũ: chỉ trả user đang 'active'.
    if (!user || user.usr_status !== 'active') return null;
    // lean() luôn trả về doc có _id tại runtime; cast để callers dùng được ._id.
    return user as User & { _id: Types.ObjectId };
  }
  async create(payload: CreateRoomDto) {
    // create array save log

    const { userId, type, name, memberIds } = payload;

    if (type !== 'private' && name == null) {
      throw new BadRequestException('vui lòng đặt tên');
    }
    // danh sach thanh vien
    const members: memberType[] = [];
    // kiểm tra xem có userid không
    if (!userId) {
      throw new BadRequestException('không tìm thấy người dùng');
    }
    // lấy thông tin người tạo phòng
    const getInforUserCreateRoom = await this.userModel
      .findOne({
        _id: this.utils.convertToObjectIdMongoose(userId),
      })
      .select({
        _id: 1,
        usr_id: 1,
        usr_fullname: 1,
      })
      .exec();
    if (!getInforUserCreateRoom) {
      throw new BadRequestException('không tìm thấy người dùng');
    }
    // them thong tin nguoi tao
    members.push({
      user_id: getInforUserCreateRoom._id,
      id: getInforUserCreateRoom.usr_id,
      role: (type === 'private' ? 'owner' : 'admin') as memberType['role'],
      name: '',
      // joinedAt: new Date(),
    });

    // kiem tra thong tin thanh vien
    const checkMemberIdsRaw = await this.userModel
      .find({
        usr_id: {
          $in: memberIds,
        },
        usr_status: 'active',
      })
      .select({
        _id: 1,
        usr_id: 1,
        usr_fullname: 1,
      })
      .exec();

    // Lọc creator ra khỏi danh sách member: FE đôi khi vô tình truyền cả
    // usr_id của chính creator trong `memberIds`. Trước đây code không lọc
    // nên `room_members` chứa creator 2 lần (1 admin + 1 member) — thấy rõ
    // trong các room cũ. Sau khi thêm unique index (user_id, room_id) trên
    // RoomsUsersState, dup này gây E11000 lúc insertMany.
    const creatorIdStr = getInforUserCreateRoom._id.toString();
    const checkMemberIds = checkMemberIdsRaw.filter(
      (m) => m._id.toString() !== creatorIdStr,
    );

    if (checkMemberIds.length > 1 && type === 'private') {
      throw new BadRequestException('thành viên không hợp lệ');
    }
    if (checkMemberIds.length <= 1 && type !== 'private') {
      throw new BadRequestException(
        'không thể tạo nhóm với thành viên ít hơn 3',
      );
    }

    // Add found members to the members array
    for (const member of checkMemberIds) {
      members.push({
        user_id: member._id,
        id: member.usr_id,
        role: (type === 'channel' ? 'guest' : 'member') as memberType['role'],
        name: member.usr_fullname || '',
        joinedAt: new Date(),
      });
    }

    const room_id =
      type === 'private'
        ? this.utils.pairRoomId(
            getInforUserCreateRoom.usr_id,
            checkMemberIds[0].usr_id,
          )
        : this.utils.randomId();

    // kiem tra xem room da duoc chua
    const checkExistRoom = await this.roomModel.findOne({
      room_id,
    });
    if (checkExistRoom) {
      const result = await this.getRoomInfo({ userId, roomId: room_id });
      return Response.success(result, 'phòng này đã được tạo');
    }
    // Example: Save the room with members (adjust fields as needed)
    const newRoom = await this.roomModel.create({
      room_id,
      room_type: type,
      room_name: type === 'private' ? '' : name,
      room_avatar:
        type === 'private'
          ? ''
          : encodeURI(`https://api.dicebear.com/9.x/initials/svg?seed=${name}`),
      room_members: members,
      created_by: getInforUserCreateRoom._id,
      created_at: new Date(),
    });
    if (!newRoom) {
      throw new BadRequestException('Tạo phòng thất bại');
    }

    // 1) ROOM_MEMBERS: 1 batched sAdd thay vì N call song song (sAdd nhận
    //    nhiều values cùng key). Trước đây fan-out N sAdd ngay trong request
    //    handler đã đánh sập service khi N≈1000.
    const allMemberObjIds = members.map((m) => m.user_id.toString());
    const creatorObjId = getInforUserCreateRoom._id.toString();
    const otherMemberObjIds = allMemberObjIds.filter(
      (id) => id !== creatorObjId,
    );

    // 2) USER_ROOMS cho creator chạy ngay: response trả về xong creator phải
    //    thấy nhóm trong list của mình lập tức (FE thường refetch list ngay
    //    sau khi POST /rooms thành công). Các member khác đẩy vào Bull queue
    //    xử lý chunk 50/lần ở background.
    // 3) RoomsUsersState dùng insertMany ordered:false: index (user_id, room_id)
    //    unique nên dup không làm crash. Trước đây chỉ tạo state cho creator
    //    — member khác không có row state, gây sai unread_count/pinned về sau.
    await Promise.all([
      this.redis.sAdd(this.key.ROOM_MEMBERS(room_id), ...allMemberObjIds),
      this.redis.sAdd(this.key.USER_ROOMS(creatorObjId), room_id),
      this.RoomsUsersState.insertMany(
        members.map((m) => ({
          room_id: newRoom._id,
          user_id: m.user_id,
        })),
        { ordered: false },
      ).catch((err) => {
        // ordered:false → mongoose vẫn throw BulkWriteError nếu có bất kỳ
        // failure nào (kể cả duplicate key). Vì index unique, dup là kỳ vọng
        // khi retry — không cần log rầm rộ.
        this.log.warn(
          `[ROOM_CREATE] RoomsUsersState.insertMany partial: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }),
    ]);

    if (otherMemberObjIds.length > 0) {
      // Enqueue background USER_ROOMS sAdd cho các member còn lại. Worker
      // bốc 50/lần (xem room-membership-sync.processor.ts) nên kể cả 10k
      // member cũng không nuốt connection pool.
      try {
        await this.membershipSyncQueue.add({
          roomCustomId: room_id,
          memberIds: otherMemberObjIds,
        });
      } catch (err) {
        // Queue down không được fail request — fallback chạy sync ngay
        // (chấp nhận response chậm hơn 1 chút thay vì 503).
        this.log.warn(
          `[ROOM_CREATE] enqueue membership-sync failed, fallback inline: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await Promise.all(
          otherMemberObjIds.map((uid) =>
            this.redis.sAdd(this.key.USER_ROOMS(uid), room_id),
          ),
        );
      }
    }

    // Invalidate two-tier room cache so reads (handle-chat) don't serve stale data.
    await this.roomCache.invalidate(newRoom);

    // 4) Một event "tạo nhóm" duy nhất thay vì N event "Y đã được thêm".
    //    Trước đây fan-out N writeLogRoom (mỗi cái ~5 mongo ops) là nguyên
    //    nhân gốc gây timeout 20s. Về UX: room mới chỉ nên có 1 system
    //    message "X đã tạo nhóm với N thành viên" trên đầu thread.
    if (type !== 'private') {
      await this.writeLogRoom({
        event_type: 'member.create',
        room_id: newRoom._id,
        placeholder: `${getInforUserCreateRoom.usr_fullname} đã tạo nhóm`,
        actor_id: getInforUserCreateRoom._id,
        targets: members.map((m) => m.user_id),
        payload: {
          creator_id: this.utils.randomId(),
          creator_name: getInforUserCreateRoom.usr_fullname,
          room_type: type,
          room_name: name,
          room_avatar: newRoom.room_avatar,
          members_count: members.length,
        },
      });
    }
    const result: Record<string, any> = await this.getRoomInfo({
      userId,
      roomId: room_id,
    });
    return Response.success(result, 'Tạo phòng thành công');
  }

  private toBoolRedis(
    v: number | boolean | string | null | undefined,
  ): boolean {
    // ioredis thường trả 0/1; một số wrapper có thể trả boolean
    // cũng xử lý luôn trường hợp string "0"/"1"

    return v == 1 || v === true || v === '1';
  }

  private async primeRoomMembershipCache(
    userId: string,
    roomId: string,
    pairId: string,
  ) {
    // Lưu cả 2 chiều để lần sau check OR không cần hit DB
    await Promise.all([
      this.redis.sAdd(this.key.ROOM_MEMBERS(roomId), userId),
      this.redis.sAdd(this.key.ROOM_MEMBERS(pairId), userId),
      this.redis.sAdd(this.key.USER_ROOMS(userId), roomId),
      this.redis.sAdd(this.key.USER_ROOMS(userId), pairId),
    ]);

    // (tuỳ chọn) đặt TTL nhẹ để tự làm mới định kỳ, tránh cache mồ côi
    // await Promise.all([
    //   this.redis.expire(this.key.ROOM_MEMBERS(roomId), 24 * 3600),
    //   this.redis.expire(this.key.ROOM_MEMBERS(pairId), 24 * 3600),
    //   this.redis.expire(this.key.USER_ROOMS(userId), 24 * 3600),
    // ]);
  }

  async checkExistedMemberRoom(userId: string, roomId: string) {
    // 1) Xác thực user
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) throw new NotFoundException('người dùng không tồn tại');

    // Chuẩn bị pairId (room private dạng A|B & B|A)
    const pairId = this.utils.pairRoomId(userInfo.usr_id, roomId);

    // 2) Check Redis theo 2 key (song song)
    const [a, b] = await Promise.all([
      this.redis.sIsMember(this.key.ROOM_MEMBERS(roomId), userId),
      this.redis.sIsMember(this.key.ROOM_MEMBERS(pairId), userId),
    ]);
    const checkExistRoomRedis = this.toBoolRedis(a) || this.toBoolRedis(b);
    if (checkExistRoomRedis) return true;

    // 3) Fallback DB (đúng field + đúng kiểu ObjectId)
    const userObjId = this.utils.convertToObjectIdMongoose(userId);

    const found = await this.roomModel.exists({
      room_id: { $in: [roomId, pairId] }, // room business id (string)
      room_members: { $elemMatch: { user_id: userObjId } }, // mảng subdoc: user_id là ObjectId
    });

    if (!found) throw new NotFoundException('phòng không tồn tại');

    // 4) Prime lại cache cho cả 2 key để lần sau khỏi hit DB
    await this.primeRoomMembershipCache(userId, roomId, pairId);

    return true;
  }
  async leavedRoom(payload: LeavingRoomDto) {
    const { userId, roomId } = payload;
    if (!userId) throw new NotFoundException('không tìm thấy người dùng');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);
    if (!checkEixsting) {
      throw new NotFoundException('người này dã thoát nhóm');
    }
    // Note: Transactions removed for standalone MongoDB compatibility
    // In production, use a replica set and re-enable transactions
    try {
      // get infor room
      const roomInfor = await this.roomModel.findOne(
        {
          room_id: roomId,
          $or: [
            {
              room_type: 'group',
            },
            {
              room_type: 'channel',
            },
          ],
        },
        {
          room_members: 1,
          room_name: 1,
          _id: 1,
        },
      );
      if (!roomInfor) throw new NotFoundException('không tìm thấy phòng');
      const members = roomInfor?.room_members ?? [];
      const targetIdx = members.findIndex(
        (m) => m.user_id.toString() === userId,
      );
      if (targetIdx === -1) throw new NotFoundException('không tìm thấy');
      const leaving = members[targetIdx];
      const isAdminLeaving = leaving.role === 'admin';
      // remover member
      await this.roomModel.updateOne(
        {
          room_id: roomId,
        },
        {
          $pull: {
            room_members: {
              id: leaving.id,
            },
          },
        },
      );
      if (!isAdminLeaving) {
        await this.writeLogRoom({
          event_type: 'member.left',
          actor_id: leaving.user_id,
          room_id: roomInfor._id,
          targets: members.map((i) => i.user_id),
          placeholder: `${leaving.name} đã rời khỏi nhóm`,
          payload: {
            left_id: this.utils.randomId(),
            left_name: leaving.name,
            left_Date: Date.now(),
            left_role: leaving.role,
            left_userId: leaving.user_id,
          },
        });
        await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
        await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
        await this.roomCache.invalidate({
          _id: roomInfor._id,
          room_id: roomId,
        });
        return Response.success('', 'Đã rời khỏi nhóm');
      }

      // check xem con admin nao ko
      const checkstilHasAdmin = members.some(
        (m, i) => i !== targetIdx && m.role === 'admin',
      );

      if (checkstilHasAdmin) {
        await this.writeLogRoom({
          event_type: 'member.left',
          actor_id: leaving.user_id,
          room_id: roomInfor._id,
          targets: members.map((i) => i.user_id),
          placeholder: `${leaving.name} đã rời khỏi nhóm`,
          payload: {
            left_id: this.utils.randomId(),
            left_name: leaving.name,
            left_Date: Date.now(),
            left_role: leaving.role,
            left_userId: leaving.user_id,
          },
        });
        await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
        await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
        await this.roomCache.invalidate({
          _id: roomInfor._id,
          room_id: roomId,
        });
        return Response.success('', 'Đã rời khỏi nhóm');
      }
      const candidates = members
        .filter((m, i) => i !== targetIdx)
        .sort(
          (a, b) =>
            new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
        );

      if (candidates.length == 0) {
        await this.roomModel.deleteOne({
          room_id: roomId,
        });
        await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
        await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
        await this.roomCache.invalidate({
          _id: roomInfor._id,
          room_id: roomId,
        });
        return Response.success('', 'Đã rời khỏi nhóm');
      }
      const promoteTarget = candidates[0];
      await this.roomModel.updateOne(
        {
          room_id: roomId,
          'room_members.user_id': promoteTarget.user_id,
        },
        {
          $set: { 'room_members.$.role': 'admin' },
        },
      );

      await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
      await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
      await this.roomCache.invalidate({ _id: roomInfor._id, room_id: roomId });
      // ghi log trong tinh nhắn
      await this.writeLogRoom({
        event_type: 'member.left',
        actor_id: leaving.user_id,
        room_id: roomInfor._id,
        targets: members.map((i) => i.user_id),
        placeholder: `${leaving.name} đã rời khỏi nhóm`,
        payload: {
          left_id: this.utils.randomId(),
          left_name: leaving.name,
          left_Date: Date.now(),
          left_role: leaving.role,
          left_userId: leaving.user_id,
        },
      });
      await this.writeLogRoom({
        event_type: 'member.change.role',
        actor_id: promoteTarget.user_id,
        room_id: roomInfor._id,
        targets: members.map((i) => i.user_id),
        placeholder: `${promoteTarget.name} đã thành quản trị viên`,
        payload: {
          _id: this.utils.randomId(),
          name: promoteTarget.name,
          Date: Date.now(),
          old_role: promoteTarget.role,
          new_role: 'admin',
          userId: promoteTarget.user_id,
        },
      });

      return Response.success({ members: members, roomId }, 'Đã rời khỏi nhóm');
    } catch (err) {
      this.log.error(err);
      throw new BadRequestException('không thể rời đi khỏi nhóm');
    }

    // get inform
  }
  async removeMemberByAdmin(payload: RemoveMemberRoomDto) {
    const { userId, roomId, memberIds } = payload;
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);
    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }
    const roomInfor = await this.roomModel.findOne(
      {
        room_id: roomId,
        $or: [
          {
            room_type: 'group',
          },
          {
            room_type: 'channel',
          },
        ],
      },
      {
        room_members: 1,
        room_name: 1,
      },
    );
    if (!roomInfor) throw new NotFoundException('không tìm thấy phòng');
    const members = roomInfor?.room_members ?? [];

    const targetIdx = members.findIndex((m) => {
      return m.user_id.toString() == userId;
    });
    if (targetIdx === -1)
      throw new NotFoundException('không tìm thấy phân quyền');
    const admin = members[targetIdx];
    const isAdmin = admin.role === 'admin';
    if (!isAdmin) throw new BadRequestException('bạn không phải quản trị viên');
    const fliterMemberOrtherAdmin = memberIds.filter((i) => i != admin.id);
    const memberRemoves = members.filter((m) =>
      fliterMemberOrtherAdmin.includes(m.id),
    );
    const promiseAll: Promise<any>[] = [];
    promiseAll.push(
      this.roomModel.updateMany(
        {
          room_id: roomId,
        },
        {
          $pull: {
            room_members: {
              id: { $in: fliterMemberOrtherAdmin },
            },
          },
        },
      ),
    );

    // remove in redis
    const rmmb = memberRemoves.map((m) =>
      this.redis.sRem(this.key.ROOM_MEMBERS(roomId), m.user_id.toString()),
    );
    const rmroom = memberRemoves.map((m) =>
      this.redis.sRem(this.key.USER_ROOMS(m.user_id.toString()), roomId),
    );
    // ghi log cho tin nhắn
    const newlog = memberRemoves.map((m) =>
      this.writeLogRoom({
        event_type: 'member.deleted',
        actor_id: admin.user_id,
        room_id: roomInfor._id,
        targets: members.map((i) => i.user_id),
        placeholder: `${m.name} đã bị xoá khỏi nhóm`,
        payload: {
          _id: this.utils.randomId(),
          name: m.name,
          deletedAt: Date.now(),

          userId: m.user_id,
        },
      }),
    );
    // tiến hành xử lý promise all
    await Promise.all([...promiseAll, ...rmmb, ...rmroom, ...newlog]);
    await this.roomCache.invalidate({ _id: roomInfor._id, room_id: roomId });
    return Response.success({ members, roomId }, 'Đã xoá thành viên');
  }

  // hiện tại ai cũng có thể thêm thành viên khác vào nhóm
  async addMemberInRoom(payload: AddMemberRoomDto) {
    const { userId, roomId, memberIds } = payload;
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }
    // lấy thông tin room
    const roomInfo = await this.roomModel.findOne({
      room_id: roomId,
    });
    if (!roomInfo)
      throw new NotFoundException('không tìm thấy thông tin về group này');

    // Check permission: Guest cannot add members
    const currentUser = roomInfo.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (currentUser?.role === 'guest') {
      throw new BadRequestException('Bạn không có quyền thêm thành viên');
    }

    const roomMember = roomInfo.room_members;
    // lấy thông tin user
    const users = await this.userModel
      .find({
        usr_id: { $in: memberIds },
        usr_status: 'active',
      })
      .select({
        _id: 1,
        usr_fullname: 1,
        usr_id: 1,
      })
      .exec();

    // Lọc bỏ những user đã ở trong nhóm (idempotent — trước đây mỗi
    // updateOne tự lọc bằng `'room_members.id': { $ne }`; giờ gộp 1 update
    // nên phải lọc ở code).
    const existingIds = new Set(roomMember.map((m) => m.id));
    const newUsers = users.filter((u) => !existingIds.has(u.usr_id));

    if (newUsers.length === 0) {
      return Response.success(
        { members: roomMember, roomId },
        'Thành viên đã có sẵn trong nhóm',
      );
    }

    const newMemberDocs = newUsers.map((u) => ({
      user_id: u._id,
      id: u.usr_id,
      name: u.usr_fullname,
      role: 'member' as memberType['role'],
      joinedAt: new Date(),
    }));
    roomMember.push(...newMemberDocs);

    const newMemberObjIds = newUsers.map((u) => u._id.toString());

    // Lấy tên người thực hiện hành động để dựng 1 system message duy nhất
    // ("X đã thêm N người vào nhóm") thay vì spam N message.
    const actor = await this.userModel
      .findById(this.utils.convertToObjectIdMongoose(userId), {
        usr_fullname: 1,
      })
      .lean<{ usr_fullname?: string }>();
    const actorName = actor?.usr_fullname || '';

    // 1) Gộp N updateOne lên cùng doc thành 1 update với $each — đây là
    //    nguyên nhân chính gây WiredTiger lock contention khi N≈1000.
    // 2) ROOM_MEMBERS sAdd: 1 batched call (sAdd accept ...values).
    // 3) RoomsUsersState insertMany: tạo state row cho từng member mới
    //    (ordered:false để dup không stop batch).
    await Promise.all([
      this.roomModel.updateOne(
        { room_id: roomId },
        { $push: { room_members: { $each: newMemberDocs } } },
      ),
      this.redis.sAdd(this.key.ROOM_MEMBERS(roomId), ...newMemberObjIds),
      this.RoomsUsersState.insertMany(
        newUsers.map((u) => ({
          room_id: roomInfo._id,
          user_id: u._id,
        })),
        { ordered: false },
      ).catch((err) => {
        this.log.warn(
          `[ROOM_ADD_MEMBER] RoomsUsersState.insertMany partial: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }),
    ]);

    await this.roomCache.invalidate(roomInfo);

    // Đẩy USER_ROOMS sAdd về Bull queue, worker xử lý chunk 50/lần. Tránh
    // nuốt connection pool khi add 1000 member 1 phát.
    try {
      await this.membershipSyncQueue.add({
        roomCustomId: roomId,
        memberIds: newMemberObjIds,
      });
    } catch (err) {
      this.log.warn(
        `[ROOM_ADD_MEMBER] enqueue membership-sync failed, fallback inline: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await Promise.all(
        newMemberObjIds.map((uid) =>
          this.redis.sAdd(this.key.USER_ROOMS(uid), roomId),
        ),
      );
    }

    // 1 system message gộp thay vì N message "Y đã được thêm".
    await this.writeLogRoom({
      event_type: 'member.added',
      actor_id: this.utils.convertToObjectIdMongoose(userId),
      room_id: roomInfo._id,
      targets: newUsers.map((u) => u._id),
      placeholder:
        newUsers.length === 1
          ? `${actorName} đã thêm ${newUsers[0].usr_fullname} vào nhóm`
          : `${actorName} đã thêm ${newUsers.length} người vào nhóm`,
      payload: {
        _id: this.utils.randomId(),
        actor_id: this.utils.convertToObjectIdMongoose(userId),
        actor_name: actorName,
        addeddAt: Date.now(),
        members_count: newUsers.length,
        added_users: newUsers.map((u) => ({
          userId: u._id,
          name: u.usr_fullname,
        })),
      },
    });

    return Response.success(
      { members: roomMember, roomId },
      'Đã thêm thành công',
    );
  }

  async GetRooms(payload: GetRoomType) {
    const { userId, options } = payload;
    const { q, limit, offset, type } = options;

    if (!userId) {
      throw new NotFoundException('không tìm thấy người dùng');
    }

    // xu lý filter
    const matchType = type && type !== 'all' ? { room_type: type } : {};
    const objectId = this.utils.convertToObjectIdMongoose(userId);

    const listRoomIds = await this.redis.sMembers(this.key.USER_ROOMS(userId));
    if (!listRoomIds) {
      throw new BadRequestException('chưa có cuộc trò chuyện nào');
    }
    const listRooms = await this.roomModel.aggregate([
      {
        $match: {
          $or: [
            {
              room_id: {
                $in: listRoomIds,
              },
            },
            {
              'room_members.user_id': objectId,
            },
          ],
          ...matchType,
        },
      },
      ...this.handlePipeline(userId),
      // Drop rooms with no resolvable name BEFORE pagination — happens
      // when a private counterpart was deleted (pipeline leaves `name`
      // empty) or a group room has no title + no derivable fallback.
      // Doing it at the DB layer (instead of post-fetch JS .filter)
      // keeps `$skip/$limit` accurate: the page size reflects only
      // displayable rooms.
      {
        $match: {
          name: { $type: 'string', $nin: [null, ''] },
        },
      },
      { $skip: Number(offset || 0) },
      { $limit: Number(limit || 1000) },
      ...(q
        ? [
            {
              $match: {
                name: { $regex: removeAccents(q), $options: 'i' }, // ✅ không phân biệt hoa/thường
              },
            },
          ]
        : []),
    ]);
    return Response.success(listRooms, 'tất cả danh sách phòng');
  }
  async changeLinkAvatarRoom(payload: ChangelinkAvatarRoomDto) {
    const { userId, roomId, link } = payload;
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }

    // Check permission before update
    const currentRoom = await this.roomModel.findOne({ room_id: roomId });
    if (!currentRoom)
      throw new NotFoundException('không tìm thấy thông tin về group này');

    const currentUser = currentRoom.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (currentUser?.role === 'guest') {
      throw new BadRequestException('Bạn không có quyền thay đổi ảnh nhóm');
    }

    // lấy thông tin room
    const roominfo = await this.roomModel.findOneAndUpdate(
      {
        room_id: roomId,
      },
      {
        room_avatar: link,
      },
      { new: true },
    );
    if (!roominfo) throw new NotFoundException('không tìm thấy phòng');
    await this.roomCache.invalidate(roominfo);
    const userinfor = roominfo.room_members.find(
      (i) => i.user_id.toString() === userId,
    );
    if (!userinfor) throw new NotFoundException('không tìm thấy thông tin');
    await this.writeLogRoom({
      event_type: 'member.change.avatar',
      room_id: roominfo._id,
      actor_id: this.utils.convertToObjectIdMongoose(userId),
      targets: roominfo.room_members.map((m) => m.user_id),
      placeholder: `${userinfor.name} đã cập nhật ảnh đại diện`,
    });
    return Response.success(
      { members: roominfo.room_members, roomId },
      'đã thay đổi ảnh thành công',
    );
  }
  async changeNameRoom(payload: ChangeNameRoomDto) {
    const { userId, roomId, name } = payload;
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }

    // Check permission before update
    const currentRoom = await this.roomModel.findOne({ room_id: roomId });
    if (!currentRoom)
      throw new NotFoundException('không tìm thấy thông tin về group này');

    const currentUser = currentRoom.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (currentUser?.role === 'guest') {
      throw new BadRequestException('Bạn không có quyền đổi tên nhóm');
    }

    // lấy thông tin room
    const room = await this.roomModel.findOneAndUpdate(
      {
        room_id: roomId,
      },
      {
        room_name: name,
      },
      { new: true },
    );
    if (!room) throw new BadRequestException('cập nhật thất bại');
    const userinfo = room.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (!userinfo)
      throw new BadRequestException('không tìm thấy thông tin thành viên');

    await this.roomCache.invalidate(room);

    await this.writeLogRoom({
      event_type: 'member.change.name',
      room_id: room._id,
      actor_id: userinfo.user_id,
      placeholder: `${userinfo.name} đã đổi tên nhóm`,
      targets: room.room_members.map((m) => m.user_id),
    });

    return Response.success(
      { members: room.room_members, roomId },
      'Đổi tên thành công',
    );
  }

  async GetRoom(payload: GetRoomDto) {
    const { userId, roomId } = payload;
    if (!userId) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return Response.success(
      await this.getRoomInfo({ userId, roomId }),
      'Lấy thông tin đoạn chat thành công',
    );
  }
  private async getRoomInfo(payload: {
    userId: string;
    roomId: string;
  }): Promise<Record<string, any>> {
    const { userId, roomId } = payload;
    if (!userId) {
      throw new NotFoundException('Không tìm thấy thông tin người dùng');
    }
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('người dùng không tồn tại');
    }
    const listRooms = await this.roomModel.aggregate([
      {
        $match: {
          $or: [
            {
              room_id: roomId,
            },
            {
              room_id: this.utils.pairRoomId(roomId, userInfo.usr_id),
            },
          ],
        },
      },
      ...this.handlePipeline(userId),
      {
        $limit: 1,
      },
    ]);
    // console.log('🚀 ~ RoomsService ~ getRoomInfo ~ listRooms:', listRooms);
    if (listRooms.length === 0) {
      throw new NotFoundException('không tìm thấy thông tin phòng');
    }
    return listRooms[0] as Record<string, any>;
  }

  // xử lý thay đổi nick name của thành viên
  async changeNickNameMember(payload: ChangeNickNameMemberDto) {
    const { userId, roomId, memberId, name } = payload;
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('Không tìm user');
    }
    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }

    // Check permission: Guest cannot change nicknames
    const currentRoom = await this.roomModel.findOne({
      $or: [
        { room_id: roomId },
        { room_id: this.utils.pairRoomId(roomId, userInfo.usr_id) },
      ],
    });
    if (!currentRoom)
      throw new NotFoundException('không tìm thấy thông tin về group này');

    const currentUser = currentRoom.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (currentUser?.role === 'guest') {
      throw new BadRequestException('Bạn không có quyền đổi biệt danh');
    }

    // update

    const roomUpdate = await this.roomModel
      .findOneAndUpdate(
        {
          $or: [
            { room_id: roomId },
            { room_id: this.utils.pairRoomId(roomId, userInfo.usr_id) },
          ],
        },
        {
          $set: {
            'room_members.$[elem].name': name, // field cần update
          },
        },
        {
          arrayFilters: [
            { 'elem.id': memberId }, // điều kiện lọc phần tử trong mảng
          ],
          new: true, // trả về document sau update
        },
      )
      .exec();

    if (!roomUpdate) {
      throw new BadRequestException('Không thể cập nhật nick name');
    }

    await this.roomCache.invalidate(roomUpdate);
    // ghi log
    //

    await this.writeLogRoom({
      event_type: 'member.change.nickName',
      room_id: roomUpdate._id,
      actor_id: userInfo._id,
      placeholder: `${userInfo.usr_fullname} đã đổi biệt danh của thành viên`,
      targets: roomUpdate.room_members.map((m) => m.user_id),
      payload: {
        member_id: memberId,
        new_name: name,
        changed_by: userInfo._id,
        changed_at: Date.now(),
      },
    });
    return Response.success(
      { members: roomUpdate.room_members, roomId: roomUpdate.room_id },
      'Đổi tên thành công',
    );
  }
  async changeRoleMember(payload: ChangeRoleMemberDto) {
    const { userId, roomId, memberId, role } = payload;
    if (!userId) {
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    }
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('Không tìm user');
    }
    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }

    // Check permission: Only Admin can change roles
    const currentRoom = await this.roomModel.findOne({
      $or: [
        { room_id: roomId },
        { room_id: this.utils.pairRoomId(roomId, userInfo.usr_id) },
      ],
    });
    if (!currentRoom)
      throw new NotFoundException('không tìm thấy thông tin về group này');

    const currentUser = currentRoom.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    if (currentUser?.role !== 'admin') {
      throw new BadRequestException(
        'Bạn không có quyền thay đổi vai trò thành viên',
      );
    }

    // update
    const roomUpdate = await this.roomModel
      .findOneAndUpdate(
        {
          $or: [
            { room_id: roomId },
            { room_id: this.utils.pairRoomId(roomId, userInfo.usr_id) },
          ],
        },
        {
          $set: {
            'room_members.$[elem].role': role, // field cần update
          },
        },
        {
          arrayFilters: [
            { 'elem.id': memberId }, // điều kiện lọc phần tử trong mảng
          ],
          new: true, // trả về document sau update
        },
      )
      .exec();

    if (!roomUpdate) {
      throw new BadRequestException('Không thể cập nhật quyền');
    }

    await this.roomCache.invalidate(roomUpdate);
    // ghi log
    await this.writeLogRoom({
      event_type: 'member.change.role',
      room_id: roomUpdate._id,
      actor_id: userInfo._id,
      placeholder: `${userInfo.usr_fullname} đã đổi quyền của thành viên`,
      targets: roomUpdate.room_members.map((m) => m.user_id),
      payload: {
        member_id: memberId,
        new_role: role,
        changed_by: userInfo._id,
        changed_at: Date.now(),
      },
    });
    return Response.success(
      { members: roomUpdate.room_members, roomId: roomUpdate.room_id },
      'Đổi quyền thành công',
    );
  }
  async PinnendRoom({ roomId, userId, pinned }: PinnedRoomDto) {
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }
    // get info user
    const userInfo = await this.userModel.findById(
      this.utils.convertToObjectIdMongoose(userId),
    );
    if (!userInfo) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // get info
    const findRoom = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(roomId, userInfo?.usr_id)],
      },
    });
    if (!findRoom) {
      throw new NotFoundException('không tìm thấy phòng');
    }
    await this.RoomsUsersState.findOneAndUpdate(
      {
        room_id: findRoom._id,
        user_id: userInfo._id,
      },
      {
        pinned: pinned,
        pinned_at: pinned ? new Date() : null,
      },
    );
    return await this.GetRoom({
      userId,
      roomId,
    });
  }

  async MutedRoom({ roomId, userId, muted }: MutedRoomDto) {
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }
    // get info user
    const userInfo = await this.userModel.findById(
      this.utils.convertToObjectIdMongoose(userId),
    );
    if (!userInfo) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // get info
    const findRoom = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(roomId, userInfo?.usr_id)],
      },
    });
    if (!findRoom) {
      throw new NotFoundException('không tìm thấy phòng');
    }
    await this.RoomsUsersState.findOneAndUpdate(
      {
        room_id: findRoom._id,
        user_id: userInfo._id,
      },
      {
        muted,
      },
    );
    return await this.GetRoom({
      userId,
      roomId,
    });
  }

  async DeletedRoom({ roomId, userId }: DeletedRoomDto) {
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
    }
    // get info user
    const userInfo = await this.userModel.findById(
      this.utils.convertToObjectIdMongoose(userId),
    );
    if (!userInfo) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // get info
    const findRoom = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(roomId, userInfo?.usr_id)],
      },
    });
    if (!findRoom) {
      throw new NotFoundException('không tìm thấy phòng');
    }
    await this.RoomsUsersState.findOneAndUpdate(
      {
        room_id: findRoom._id,
        user_id: userInfo._id,
      },
      {
        clear_before_ts: new Date(),
      },
    );
    return await this.GetRoom({
      userId,
      roomId,
    });
  }
}
