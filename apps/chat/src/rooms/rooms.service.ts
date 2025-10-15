import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Utils from '@app/helpers/utils';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { REDISKEY } from '@app/constants/RedisKey';
import { LeavingRoomDto } from './dto/leaving-room.dto';
import { removeMeberRoomDto } from './dto/remove-member.dto';
import { memberId, Room } from 'libs/db/src/mongo/model/room.model';
import { User } from 'libs/db/src/mongo/model/user.model';

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
    const { userId, type, name, memberIds } = payload;

    if (type !== 'private' && name == null) {
      throw new BadRequestException('vui lòng đặt tên');
    }
    // danh sach thanh vien
    const members: memberId[] = [];
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
      joinedAt: new Date(),
    });

    // kiem tra thong tin thanh vien
    const checkMemberIds = await this.userModel
      .find({
        usr_id: {
          $in: memberIds,
        },
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
          : `https://api.dicebear.com/9.x/initials/svg?seed=${name}`,
      room_members: members,
      created_by: getInforUserCreateRoom._id,
      created_at: new Date(),
      room_log: [
        {
          name: getInforUserCreateRoom.usr_fullname,
          dateAt: new Date(),
          action: 'tạo phòng',
        },
      ],
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

    // voi room type = private
    // if (type === 'private') {
    // }
  }

  async createRoomLogs(userId: string, action: string, roomId: string) {
    // check exist user include room
    const isMemberNow = await this.roomModel.exists({
      room_id: roomId,
      'room_members.user_id': this.utils.convertToObjectIdMongoose(userId),
    });
    if (!isMemberNow) {
      return false;
    }
    // get infor user
    const infor = await this.userModel
      .findOne({ _id: this.utils.convertToObjectIdMongoose(userId) })
      .select({
        usr_fullname: 1,
      })
      .exec();
    if (!infor) {
      return false;
    }
    await this.roomModel.findByIdAndUpdate(
      {
        room_id: roomId,
      },
      {
        $addToSet: {
          action,
          name: infor.usr_fullname,
        },
      },
    );
    return true;
  }
  async checkExistedMemberRoom(userId: string, roomId: string) {
    // check in redis
    const checkExistRoomRedis = await this.redis.sIsMember(
      this.key.ROOM_MEMBER + roomId,
      userId,
    );
    if (checkExistRoomRedis) {
      return true;
    }
    //check in mongose

    const checkExistDB = await this.roomModel.exists({
      room_id: roomId,
      'room_members.user_id': userId,
    });
    if (checkExistDB) {
      return true;
    }
    return false;
  }
  async leavedRoom(payload: LeavingRoomDto) {
    const { userId, roomId } = payload;
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
              user_id: this.utils.convertToObjectIdMongoose(userId),
            },
          },
          $push: {
            room_log: {
              name: 'Leaving Room',
              dataAt: new Date(),
              action: `${leaving.name} đã rời khỏi khóm`,
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
      const leavingJoined = new Date(leaving.joinedAt);
      const candidates = members
        .filter((m, i) => i !== targetIdx)
        .sort(
          (a, b) =>
            new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
        );
      const promoteTarget = candidates.find(
        (m) => new Date(m.joinedAt) > leavingJoined,
      );
      if (!promoteTarget) {
        await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
        await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
        return Response.success('', 'Đã rời khỏi nhóm');
      }
      await this.roomModel.updateOne(
        {
          room_id: roomId,
          'room_members.user_id': promoteTarget.user_id,
        },
        {
          $set: { 'room_members.$.role': 'admin' },
          $push: {
            room_log: {
              name: 'Administration',
              dateAt: new Date(),
              action: `${promoteTarget.name} thành quản trị viên`,
            },
          },
        },
      );

      await this.redis.sRem(this.key.ROOM_MEMBER + roomId, userId);
      await this.redis.sRem(this.key.USER_ROOM + userId, roomId);
      return Response.success('', 'Đã rời khỏi nhóm');
    } catch (err) {
      this.log.error(err);
      throw new BadRequestException('không thể rời đi khỏi nhóm');
    }

    // get inform
  }
  async removeMemberByAdmin(payload: removeMeberRoomDto) {
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
    const promiseAll = memberRemoves.map((i) =>
      this.roomModel.updateOne(
        { room_id: roomId },
        {
          $push: {
            room_log: {
              name: 'Remove Room',
              dateAt: new Date(),
              action: `${i.name} đã xoá khỏi phòng`,
            },
          },
        },
      ),
    );
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
    // tiến hành xử lý promise all
    await Promise.all([...promiseAll, ...rmmb, ...rmroom]);
    return Response.success('', 'Đã xoá thành viên');
  }

  /**
   * Helper: Tìm phòng private theo "nửa" room_id (trước hoặc sau dấu chấm)
   * Regex search: thử ^half\. trước (index-friendly), fallback \.half$
   */
  private async findRoomByHalf(half: string) {
    const h = this.escapeRegex(half);
    // Thử nửa đứng TRƯỚC: ^half\.  (có cơ hội dùng index room_id:1)
    let doc = await this.roomModel
      .findOne(
        { room_type: 'private', room_id: new RegExp(`^${h}\\.`) },
        { _id: 1, room_id: 1, room_type: 1, members: 1, room_name: 1 },
      )
      .lean()
      .exec();
    if (doc) return doc;

    // Fallback nửa đứng SAU: \.half$  (khó dùng index nhưng cần có)
    doc = await this.roomModel
      .findOne(
        { room_type: 'private', room_id: new RegExp(`\\.${h}$`) },
        { _id: 1, room_id: 1, room_type: 1, members: 1, room_name: 1 },
      )
      .lean()
      .exec();

    return doc; // null nếu không có
  }

  /**
   * Tìm phòng theo ID hoặc "nửa" ID (cho private room).
   * - Nếu không có dấu chấm → thử group id trước, fallback nửa private.
   * - Nếu có dấu chấm → coi như full private id.
   */
  async findRoomById(roomIdOrHalf: string) {
    const s = String(roomIdOrHalf).trim();

    // Nếu là group (không có dấu chấm) → so thẳng
    if (!s.includes('.')) {
      // thử group id trước
      const byGroup = await this.roomModel
        .findOne(
          { room_type: 'group', room_id: s },
          {
            id: '$room_id',
            room_id: 1,
            type: '$room_type',
            members: '$room_mebers',
            name: '$room_name',
            avatar: '$room_avatar',
          },
        )
        .lean()
        .exec();
      if (byGroup) return byGroup;

      // nếu không phải group, coi như là "một nửa" private
      return this.findRoomByHalf(s);
    }

    // Nếu có dấu chấm → coi như full private id
    const doc = await this.roomModel
      .findOne(
        { room_type: 'private', room_id: s },
        {
          id: '$room_id',
          room_id: 1,
          type: '$room_type',
          members: '$room_mebers',
          name: '$room_name',
          avatar: '$room_avatar',
        },
      )
      .lean()
      .exec();
    return doc;
  }

  /**
   * Helper: Escape special regex characters để tránh injection
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
