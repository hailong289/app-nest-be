import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Utils from '@app/helpers/utils';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import { memberType, Room } from 'libs/db/src/mongo/model/room.model';
import { User } from 'libs/db/src/mongo/model/user.model';
import {
  AddMemberRoomDto,
  CreateRoomDto,
  GetRoomType,
  LeavingRoomDto,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';
import removeAccents from 'remove-accents'; // npm i remove-accents
@Injectable()
export class RoomsService {
  private readonly utils = Utils;
  private readonly key = REDISKEY;
  private readonly log = new Logger();
  constructor(
    @InjectModel('Room') private readonly roomModel: Model<Room>,
    @InjectModel('User') private readonly userModel: Model<User>,
    private readonly redis: RedisService,
  ) {}
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
        role: type === 'private' ? 'owner' : 'member',
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
      throw new BadRequestException('ban da tung nhan tin voi nguoi nay');
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
    const rmPrefix: Record<string, any> = this.utils.unprefix(
      newRoom.toObject(),
      'room_',
    );
    rmPrefix.room_id = room_id;
    if (typeof rmPrefix?.id === 'string') {
      rmPrefix.id = rmPrefix.id
        .replace('.', '')
        .replace(getInforUserCreateRoom.usr_id, '');
    }
    // add member save info in redis
    const saddMember = members.map((i) => {
      return this.redis.sAdd(
        this.key.ROOM_MEMBER + room_id,
        i.user_id.toString(),
      );
    });
    const saddRoom = members.map((i) =>
      this.redis.sAdd(this.key.USER_ROOM + i.user_id.toString(), room_id),
    );
    await Promise.all([...saddMember, ...saddRoom]);
    return Response.success(rmPrefix, 'Tạo phòng thành công');
  }

  async checkExistedMemberRoom(userId: string, roomId: string) {
    // check in redis
    const checkExistRoomRedis = await this.redis.sIsMember(
      this.key.ROOM_MEMBER + roomId,
      userId,
    );
    console.log(
      '🚀 ~ RoomsService ~ checkExistedMemberRoom ~ checkExistRoomRedis:',
      checkExistRoomRedis,
    );
    if (checkExistRoomRedis) {
      return true;
    }
    //check in mongose

    const checkExistDB = await this.roomModel.exists({
      room_id: roomId,
      'room_members.user_id': this.utils.convertToObjectIdMongoose(userId),
    });
    if (checkExistDB) {
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
        },
      );
      if (!roomId) throw new NotFoundException('không tìm thấy phòng');
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
        await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
        await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
        return Response.success('', 'Đã rời khỏi nhóm');
      }

      // check xem con admin nao ko
      const checkstilHasAdmin = members.some(
        (m, i) => i !== targetIdx && m.role === 'admin',
      );

      if (checkstilHasAdmin) {
        await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
        await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
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
        await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
        await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
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

      await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
      await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
      // ghi log trong tinh nhắn
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
    if (!roomId) throw new NotFoundException('không tìm thấy phòng');
    const members = roomInfor?.room_members ?? [];
    const targetIdx = members.findIndex((m) => m.user_id.toString() === userId);
    if (targetIdx === -1) throw new NotFoundException('không tìm thấy');
    const admin = members[targetIdx];
    const isAdmin = admin.role === 'admin';
    if (!isAdmin) throw new BadRequestException('bạn không phải quản trị viên');
    const fliterMemberOrtherAdmin = memberIds.filter((i) => i != admin.id);
    const memberRemoves = members.filter((m) =>
      fliterMemberOrtherAdmin.includes(m.id),
    );
    console.log(
      '🚀 ~ RoomsService ~ removeMemberByAdmin ~ memberRemoves:',
      memberRemoves,
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
      this.redis.sRem(this.key.ROOM_MEMBER + roomId, m.user_id.toString()),
    );
    const rmroom = memberRemoves.map((m) =>
      this.redis.sRem(this.key.USER_ROOM + m.user_id.toString(), roomId),
    );
    // ghi log cho tin nhắn
    // tiến hành xử lý promise all
    await Promise.all([...promiseAll, ...rmmb, ...rmroom]);
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
    console.log('🚀 ~ RoomsService ~ addMemberInRoom ~ users:', users);
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
      this.redis.sAdd(this.key.ROOM_MEMBER + roomId, m._id.toString()),
    );
    const addroom = users.map((m) =>
      this.redis.sAdd(this.key.USER_ROOM + m._id.toString(), roomId),
    );
    await Promise.all([...PromiseAll, ...addmb, ...addroom]);
    // ghi log tin hành động
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

    const listRoomIds = await this.redis.sMembers(this.key.USER_ROOM + userId);
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
      {
        $unionWith: {
          coll: 'Rooms',
          pipeline: [
            {
              $lookup: {
                from: 'Message',
                let: {
                  uid: objectId,
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ['$msg_sender', '$$uid'],
                      },
                    },
                  },
                ], // Add your lookup pipeline here if needed
                as: 'sent_msgs',
              },
            },
            {
              $match: { 'sent_msgs.0': { $exists: true } },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' },
        },
      },
      {
        $replaceRoot: { newRoot: '$doc' },
      },
      {
        $lookup: {
          from: 'Messages',
          localField: 'room_last_messages',
          foreignField: '_id',
          as: 'last_message',
        },
      },
      {
        $unwind: {
          path: '$last_message',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'Users',
          localField: 'room_members.user_id',
          foreignField: '_id',
          pipeline: [
            { $project: { _id: 1, usr_id: 1, usr_fullname: 1, usr_avatar: 1 } },
          ],
          as: 'members',
        },
      },
      {
        $lookup: {
          from: 'Users',
          localField: 'room_members.user_id',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, usr_avatar: 1 } }],
          as: 'userAvatars',
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
                    avatar: {
                      $let: {
                        vars: {
                          matched: {
                            $first: {
                              $filter: {
                                input: '$userAvatars',
                                as: 'ua',
                                cond: { $eq: ['$$ua._id', '$$m.user_id'] },
                              },
                            },
                          },
                        },
                        in: '$$matched.usr_avatar',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unset: 'userAvatars' },
      {
        $lookup: {
          from: 'Messages',
          let: {
            rid: '$_id',
            uid: objectId,
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_room', '$$rid'] }, // RÀNG BUỘC THEO ROOM HIỆN TẠI
                    { $eq: ['$msg_sender', '$$uid'] },
                  ],
                },
              },
            },
          ],
          as: 'sent_by_me',
        },
      },
      {
        $match: {
          $or: [
            { 'room_members.user_id': objectId },
            { 'sent_by_me.0': { $exists: true } },
          ],
        },
      },
      {
        $addFields: {
          _hasAvatar: {
            $ne: [{ $ifNull: ['$room_avatar', ''] }, ''],
          },
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
              '$$REMOVE', // bỏ field nếu không cần
            ],
          },
          groupAvatars: {
            $cond: [
              { $not: ['$_hasAvatar'] },
              { $slice: ['$members.avatar', 4] },
              '$$REMOVE',
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'event_messages',
          let: {
            lastMsgId: '$room_last_messages',
            me: objectId,
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ['$event_msgId', '$$lastMsgId'],
                    },
                    { $eq: ['$event_userId', '$$me'] },
                    { $eq: ['$event_type', 'readed'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'my_lastmsg_reads',
        },
      },
      {
        $addFields: {
          is_read: {
            $or: [
              // 1) Tin cuối do chính mình gửi -> coi như đã đọc
              { $eq: ['$last_message.msg_sender', objectId] },

              // 2) Hoặc có event 'readed' cho last_message của mình (khi không phải mình là sender)
              {
                $and: [
                  { $gt: [{ $size: '$my_lastmsg_reads' }, 0] },
                  { $ne: ['$last_message.msg_sender', objectId] },
                ],
              },
            ],
          },
        },
      },
      {
        $sort: {
          'last_message.createdAt': -1,
        },
      },
      {
        /**
         * specifications: The fields to
         *   include or exclude.
         */
        $project: {
          _id: 0,
          id: {
            $cond: [
              { $eq: ['$room_type', 'private'] },
              '$otherMember.id',
              '$room_id',
            ],
          },
          roomId: '$room_id',
          updatedAt: 1,
          type: '$room_type',
          last_message: {
            content: '$last_message.msg_content',
            createdAt: '$last_message.createdAt',
            id: '$last_message.msg_id',
          },
          name: {
            $cond: [
              { $eq: ['$room_type', 'private'] },
              '$otherMember.name',
              '$room_name',
            ],
          },
          is_read: {
            $cond: [
              { $ifNull: ['$last_message._id', false] }, // có last_message?
              {
                $or: [
                  { $eq: ['$last_message.msg_sender', objectId] },
                  {
                    $and: [
                      { $gt: [{ $size: '$my_lastmsg_reads' }, 0] },
                      { $ne: ['$last_message.msg_sender', objectId] },
                    ],
                  },
                ],
              },
              true, // không có last_message -> coi như đã đọc
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
  /**
   * Helper: Tìm phòng private theo "nửa" room_id (trước hoặc sau dấu chấm)
   * Regex search: thử ^half\. trước (index-friendly), fallback \.half$
   */
  // private async findRoomByHalf(half: string) {
  //   const h = this.escapeRegex(half);
  //   // Thử nửa đứng TRƯỚC: ^half\.  (có cơ hội dùng index room_id:1)
  //   let doc = await this.roomModel
  //     .findOne(
  //       { room_type: 'private', room_id: new RegExp(`^${h}\\.`) },
  //       { _id: 1, room_id: 1, room_type: 1, members: 1, room_name: 1 },
  //     )
  //     .lean()
  //     .exec();
  //   if (doc) return doc;

  //   // Fallback nửa đứng SAU: \.half$  (khó dùng index nhưng cần có)
  //   doc = await this.roomModel
  //     .findOne(
  //       { room_type: 'private', room_id: new RegExp(`\\.${h}$`) },
  //       { _id: 1, room_id: 1, room_type: 1, members: 1, room_name: 1 },
  //     )
  //     .lean()
  //     .exec();

  //   return doc; // null nếu không có
  // }

  // /**
  //  * Tìm phòng theo ID hoặc "nửa" ID (cho private room).
  //  * - Nếu không có dấu chấm → thử group id trước, fallback nửa private.
  //  * - Nếu có dấu chấm → coi như full private id.
  //  */
  // async findRoomById(roomIdOrHalf: string) {
  //   const s = String(roomIdOrHalf).trim();

  //   // Nếu là group (không có dấu chấm) → so thẳng
  //   if (!s.includes('.')) {
  //     // thử group id trước
  //     const byGroup = await this.roomModel
  //       .findOne(
  //         { room_type: 'group', room_id: s },
  //         {
  //           id: '$room_id',
  //           room_id: 1,
  //           type: '$room_type',
  //           members: '$room_mebers',
  //           name: '$room_name',
  //           avatar: '$room_avatar',
  //         },
  //       )
  //       .lean()
  //       .exec();
  //     if (byGroup) return byGroup;

  //     // nếu không phải group, coi như là "một nửa" private
  //     return this.findRoomByHalf(s);
  //   }

  //   // Nếu có dấu chấm → coi như full private id
  //   const doc = await this.roomModel
  //     .findOne(
  //       { room_type: 'private', room_id: s },
  //       {
  //         id: '$room_id',
  //         room_id: 1,
  //         type: '$room_type',
  //         members: '$room_mebers',
  //         name: '$room_name',
  //         avatar: '$room_avatar',
  //       },
  //     )
  //     .lean()
  //     .exec();
  //   return doc;
  // }

  // /**
  //  * Helper: Escape special regex characters để tránh injection
  //  */
  // private escapeRegex(str: string): string {
  //   return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // }
}
