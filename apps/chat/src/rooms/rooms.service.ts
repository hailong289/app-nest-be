import {
  ChangeNickNameMemberDto,
  CreateRoomEvent,
  GetRoomDto,
} from './../../../../libs/dto/src/room.dto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
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
  Room,
  RoomEvent,
  User,
  EventRoomType,
  RoomsUsersState,
} from 'libs/db/src';

@Injectable()
export class RoomsService {
  private readonly utils = Utils;
  private readonly key = REDISKEY;
  private readonly log = new Logger();
  constructor(
    @InjectModel('Room') private readonly roomModel: Model<Room>,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('RoomEvent') private readonly roomEvent: Model<RoomEvent>,
    private readonly redis: RedisService,
    @InjectModel('RoomsUsersState')
    private readonly RoomsUsersState: Model<RoomsUsersState>,
  ) {}
  // handlog not public api
  async writeLogRoom(CreateRoomEvent: CreateRoomEvent) {
    return this.roomEvent.create(CreateRoomEvent);
    // socket các hành động
  }
  private handlePipeline(userId: string): PipelineStage[] {
    const objectId = this.utils.convertToObjectIdMongoose(userId);
    const result: PipelineStage[] = [
      /** 1) Lấy Rooms mà user là member (nếu muốn bao gồm cả phòng từng gửi, xem block (1b) + (1c)) */
      {
        $match: {
          'room_members.user_id': objectId,
        },
      },

      /** (1b) Tùy chọn: lấy phòng user từng gửi (kể cả không còn trong members)
       *  -> Bỏ comment cả (1b) và (1c) nếu cần OR theo sent_by_me
       */
      // {
      //   $lookup: {
      //     from: "Messages",
      //     let: { rid: "$_id" },
      //     pipeline: [
      //       {
      //         $match: {
      //           $expr: {
      //             $and: [
      //               { $eq: ["$msg_room", "$$rid"] },
      //               { $eq: ["$msg_sender", objectId] },
      //             ],
      //           },
      //         },
      //       },
      //       { $limit: 1 },
      //     ],
      //     as: "sent_by_me",
      //   },
      // },
      /** (1c) OR theo members hoặc đã từng gửi */
      // {
      //   $match: {
      //     $or: [
      //       { "room_members.user_id": objectId },
      //       { "sent_by_me.0": { $exists: true } },
      //     ],
      //   },
      // },

      /** 2) Map thông tin user (name, avatar) vào room_members (1 lookup duy nhất) */
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
                $mergeObjects: [
                  '$$m',
                  {
                    name: {
                      $let: {
                        vars: {
                          hit: {
                            $first: {
                              $filter: {
                                input: '$membersInfo',
                                as: 'u',
                                cond: { $eq: ['$$u._id', '$$m.user_id'] },
                              },
                            },
                          },
                        },
                        in: '$$hit.usr_fullname',
                      },
                    },
                    avatar: {
                      $let: {
                        vars: {
                          hit: {
                            $first: {
                              $filter: {
                                input: '$membersInfo',
                                as: 'u',
                                cond: { $eq: ['$$u._id', '$$m.user_id'] },
                              },
                            },
                          },
                        },
                        in: '$$hit.usr_avatar',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unset: 'membersInfo' },

      /** 3) RoomsState (đúng khóa foreignField: room_id) */
      {
        $lookup: {
          from: 'RoomsState',
          localField: '_id', // _id của Rooms
          foreignField: 'room_id', // room_id trong RoomsState
          as: 'state',
        },
      },
      { $set: { state: { $first: '$state' } } },

      /** 4) Tài liệu last_message (nếu cần thêm field ngoài snapshot) */
      {
        $lookup: {
          from: 'Messages',
          localField: 'state.last_message_id',
          foreignField: '_id',
          as: 'last_message_doc',
        },
      },
      { $set: { last_message_doc: { $first: '$last_message_doc' } } },

      /** 5) Trạng thái của tôi trong phòng (pin, last_read_at, ...) */
      {
        $lookup: {
          from: 'RoomsUsersState',
          let: { rid: '$_id', uid: objectId },
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
          ],
          as: 'my_state',
        },
      },
      { $set: { my_state: { $first: '$my_state' } } },

      /** 6) Fallback: tôi đã read chính last_message chưa? */
      {
        $lookup: {
          from: 'MessageReads',
          let: { lm: '$state.last_message_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_id', '$$lm'] },
                    { $eq: ['$user_id', objectId] },
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

      /** 7) is_read:
       *  - Không có last_message => true
       *  - sender == tôi => true
       *  - last_message.createdAt <= my_state.last_read_at => true
       *  - có record trong MessageReads => true
       */
      {
        $addFields: {
          is_read: {
            $let: {
              vars: { lm: '$last_message_doc' },
              in: {
                $cond: [
                  { $not: ['$$lm'] },
                  true,
                  {
                    $or: [
                      { $eq: ['$$lm.msg_sender', objectId] },
                      {
                        $and: [
                          { $ifNull: ['$my_state.last_read_at', false] },
                          {
                            $lte: ['$$lm.createdAt', '$my_state.last_read_at'],
                          },
                        ],
                      },
                      { $ifNull: ['$my_lastmsg_read._id', false] },
                    ],
                  },
                ],
              },
            },
          },
        },
      },

      /** 8) Đếm số tin chưa đọc (FAST) theo mốc last_read_at, exclude tin do tôi gửi */
      {
        $lookup: {
          from: 'Messages',
          let: {
            rid: '$_id',
            lastAt: '$my_state.last_read_at',
            uid: objectId,
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_room', '$$rid'] },
                    { $ne: ['$msg_sender', '$$uid'] },
                    // Nếu có soft-delete: chỉ đếm tin chưa xoá/thu hồi
                    {
                      $or: [
                        { $eq: ['$deletedAt', null] },
                        { $not: ['$deletedAt'] },
                      ],
                    },
                    // Nếu có mốc last_read_at → chỉ lấy tin mới hơn mốc
                    {
                      $cond: [
                        { $ifNull: ['$$lastAt', false] },
                        { $gt: ['$createdAt', '$$lastAt'] },
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
      { $set: { unread_count: { $ifNull: [{ $first: '$unread.cnt' }, 0] } } },
      { $unset: 'unread' },

      /** 9) Avatar hiển thị (private/group; fallback lấy 1 ảnh từ group nếu room_avatar rỗng) */
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
                    cond: { $ne: ['$$m.user_id', objectId] },
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

      /** 10) Mốc sort: ưu tiên snapshot.createdAt, fallback updatedAt của Rooms */
      {
        $addFields: {
          _lastTs: {
            $ifNull: ['$state.last_message_snapshot.createdAt', '$updatedAt'],
          },
        },
      },
      { $sort: { _lastTs: -1 } },

      /** 11) Project ra output gọn cho UI */
      {
        $project: {
          _id: 0,
          // id hiển thị (giữ logic cũ của bạn)
          id: {
            $cond: [
              { $eq: ['$room_type', 'private'] },
              '$otherMember.id',
              '$room_id', // business id chuỗi bạn tạo bằng Utils.randomId()
            ],
          },
          roomId: '$room_id', // business id
          _mongoId: '$_id', // nếu client cần ObjectId thật
          type: '$room_type',
          updatedAt: 1,
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
            id: '$state.last_message_id',
            content: '$state.last_message_snapshot.content',
            createdAt: '$state.last_message_snapshot.createdAt',
            sender: '$state.last_message_snapshot.sender_id',
          },

          is_read: 1,
          unread_count: 1,
          my_state: 1,
        },
      },
    ];

    return result;
  }

  private async getUserInfo(userId: string) {
    const user = await this.userModel
      .findOne({
        _id: this.utils.convertToObjectIdMongoose(userId),
        usr_status: 'active',
      })
      .select({
        _id: 1,
        usr_fullname: 1,
        usr_id: 1,
      })
      .exec();

    return user;
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
      role: type === 'private' ? 'owner' : 'admin',
      name: getInforUserCreateRoom.usr_fullname || '',
      // joinedAt: new Date(),
    });

    // kiem tra thong tin thanh vien
    const checkMemberIds = await this.userModel
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
        role: type === 'channel' ? 'guest' : 'member',
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

    // add member save info in redis
    const saddMember = members.map((i) => {
      return this.redis.sAdd(
        this.key.ROOM_MEMBERS(room_id),
        i.user_id.toString(),
      );
    });
    const saddRoom = members.map((i) =>
      this.redis.sAdd(this.key.USER_ROOMS(i.user_id.toString()), room_id),
    );
    await Promise.all([
      ...saddMember,
      ...saddRoom,
      this.RoomsUsersState.create({
        room_id: newRoom._id,
        user_id: this.utils.convertToObjectIdMongoose(userId),
      }),
    ]);

    // ghi log
    if (type !== 'private') {
      const newlogs = members.map((i) => {
        let payload: Record<string, any> | undefined = undefined;
        const eventTypeVal: EventRoomType =
          i.role === 'admin' ? 'member.create' : 'member.added';
        // build a minimal CreateRoomEvent and cast to satisfy the DTO type
        if (i.role === 'admin') {
          payload = {
            creator_id: this.utils.randomId(),
            creator_name: i.name,
            room_type: type,
            room_name: name,
            room_avatar: newRoom.room_avatar,
            members_count: members.length,
          };
          return this.writeLogRoom({
            event_type: eventTypeVal,
            room_id: newRoom._id,
            placeholder: `${i.name} đã tạo nhóm`,
            actor_id: getInforUserCreateRoom._id,
            targets: [],
            payload,
          } as CreateRoomEvent);
        } else {
          payload = {
            user_id: i.user_id,
            user_name: i.name,
            joinedAt: i.joinedAt,
            joined_by: getInforUserCreateRoom._id,
          };
          return this.writeLogRoom({
            event_type: eventTypeVal,
            room_id: newRoom._id,
            placeholder: `${i.name} đã đã được thêm vào nhóm`,
            actor_id: getInforUserCreateRoom._id,
            targets: members.map((m) => m.user_id),
            payload,
          } as CreateRoomEvent);
        }
      });
      await Promise.all(newlogs);
    }
    const result: Record<string, any> = await this.getRoomInfo({
      userId,
      roomId: room_id,
    });
    return Response.success(result, 'Tạo phòng thành công');
  }

  async checkExistedMemberRoom(userId: string, roomId: string) {
    // check in redis
    const checkExistRoomRedis = await this.redis.sIsMember(
      this.key.ROOM_MEMBERS(roomId),
      userId,
    );

    if (checkExistRoomRedis) {
      return true;
    }
    //check in mongose
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('người dùng không tồn tại');
    }
    const checkExistDB = await this.roomModel.exists({
      $or: [
        {
          room_id: roomId,
        },
        {
          room_id: this.utils.pairRoomId(userInfo.usr_id, roomId),
        },
      ],
    });
    if (checkExistDB) {
      await Promise.all([
        this.redis.sAdd(this.key.ROOM_MEMBERS(roomId), userId),
        this.redis.sAdd(this.key.USER_ROOMS(userId), roomId),
      ]);
      return true;
    }
    return false;
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
        } as CreateRoomEvent);
        await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
        await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
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
        } as CreateRoomEvent);
        await this.redis.sRem(this.key.ROOM_MEMBERS(roomId), userId);
        await this.redis.sRem(this.key.USER_ROOMS(userId), roomId);
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
      } as CreateRoomEvent);
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
      } as CreateRoomEvent);
      return Response.success('', 'Đã rời khỏi nhóm');
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
      } as CreateRoomEvent),
    );
    // tiến hành xử lý promise all
    await Promise.all([...promiseAll, ...rmmb, ...rmroom, ...newlog]);
    return Response.success('', 'Đã xoá thành viên');
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
    const PromiseAll = users.map((m) =>
      this.roomModel.updateOne(
        {
          room_id: roomId,
          'room_members.id': { $ne: m.usr_id },
        },
        {
          $push: {
            room_members: {
              id: m.usr_id,
              name: m.usr_fullname,
              user_id: m._id,
              role: 'member',
            },
          },
        },
      ),
    );
    const addmb = users.map((m) =>
      this.redis.sAdd(this.key.ROOM_MEMBERS(roomId), m._id.toString()),
    );
    const addroom = users.map((m) =>
      this.redis.sAdd(this.key.USER_ROOMS(m._id.toString()), roomId),
    );
    // ghi log tin hành động
    const newlog = users.map((m) =>
      this.writeLogRoom({
        event_type: 'member.added',
        actor_id: this.utils.convertToObjectIdMongoose(userId),
        room_id: roomInfo._id,
        targets: users.map((i) => i._id),
        placeholder: `${m.usr_fullname} đã đượct thêm nhóm`,
        payload: {
          _id: this.utils.randomId(),
          name: m.usr_fullname,
          addeddAt: Date.now(),

          userId: m._id,
        },
      } as CreateRoomEvent),
    );
    await Promise.all([...PromiseAll, ...addmb, ...addroom, ...newlog]);
    return Response.success('', 'Đã thêm thành công');
  }

  async GetRooms(payload: GetRoomType) {
    const { userId, options } = payload;
    const { q, limit, offset, type } = options;

    if (!userId) {
      throw new NotFoundException('không tìm thấy người dùng');
    }

    // xu lý filter
    const matchType = type && type !== 'all' ? { room_type: type } : {};
    console.log('🚀 ~ RoomsService ~ GetRooms ~ matchType:', matchType);
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
    const userinfor = roominfo?.room_members.find(
      (i) => i.user_id.toString() === userId,
    );
    if (!userinfor) throw new NotFoundException('không tìm thấy thông tin');
    await this.writeLogRoom({
      event_type: 'member.change.avatar',
      room_id: roominfo?._id,
      actor_id: this.utils.convertToObjectIdMongoose(userId),
      targets: roominfo?.room_members.map((m) => m.user_id),
      placeholder: `${userinfor.name} đã cập nhật ảnh đại diện`,
    } as CreateRoomEvent);
    return Response.success(true, 'đã thay đổi ảnh thành công');
  }
  async changeNameRoom(payload: ChangeNameRoomDto) {
    const { userId, roomId, name } = payload;
    if (!userId)
      throw new NotFoundException('bạn không phải thành viên nhóm này');
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
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

    await this.writeLogRoom({
      event_type: 'member.change.name',
      room_id: room._id,
      actor_id: userinfo?.user_id,
      placeholder: `${userinfo?.name} đã đổi tên nhóm`,
      targets: room.room_members.map((m) => m.user_id),
    } as CreateRoomEvent);
    return Response.success(true, 'Đổi tên thành công');
  }

  async GetRoom(payload: GetRoomDto) {
    const { userId, roomId } = payload;
    if (!userId) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    const checkEixsting = await this.checkExistedMemberRoom(userId, roomId);

    if (!checkEixsting) {
      throw new NotFoundException('bạn dã thoát nhóm');
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
    } as CreateRoomEvent);
    return Response.success(true, 'Đổi tên thành công');
  }
}
