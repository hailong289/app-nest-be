import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Error, Model } from 'mongoose';
import { memberId, Room } from '../database/mongo/model/room.model';
import { User } from 'apps/auth/src/models/user';
import Utils from '@app/helpers/utils';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel('Room') private readonly roomModel: Model<Room>,
    @InjectModel('UserModel') private readonly userModel: Model<User>,
  ) {}
  async create(payload: CreateRoomDto) {
    const { userId, type, name, avatar, memberIds } = payload;
    console.log(
      "🚀 ~ RoomsService ~ create ~ type !== 'private' && name == '':",
      type !== 'private' && name == null,
    );
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
        _id: Utils.convertToObjectIdMongoose(userId),
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
    checkMemberIds.forEach((member) => {
      members.push({
        user_id: member._id,
        id: member.usr_id,
        role: type === 'private' ? 'owner' : 'member',
        name: member.usr_fullname || '',
        joinedAt: new Date(),
      });
    });
    console.log('🚀 ~ RoomsService ~ create ~ checkMemberIds:', checkMemberIds);
    const room_id =
      type === 'private'
        ? Utils.pairRoomId(
            getInforUserCreateRoom.usr_id,
            checkMemberIds[0].usr_id,
          )
        : Utils.randomId();

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
      room_name: name,
      room_avatar: avatar,
      room_members: members,
      created_by: getInforUserCreateRoom._id,
      created_at: new Date(),
    });
    const rmPrefix: Record<string, any> = Utils.unprefix(
      newRoom.toObject(),
      'room_',
    );
    rmPrefix.room_id = room_id;
    if (typeof rmPrefix?.id === 'string') {
      rmPrefix.id = rmPrefix.id
        .replace('.', '')
        .replace(getInforUserCreateRoom.usr_id, '');
    }

    return Response.success(rmPrefix, 'Tạo phòng thành công');

    // voi room type = private
    // if (type === 'private') {
    // }
  }

  async createRoomLogs(userId: string, action: string, roomId: string) {
    // check exist user include room
    const isMemberNow = await this.roomModel.exists({
      room_id: roomId,
      'room_members.user_id': Utils.convertToObjectIdMongoose(userId),
    });
    if (!isMemberNow) {
      return false;
    }
    // get infor user
    const infor = await this.userModel
      .findOne({ _id: Utils.convertToObjectIdMongoose(userId) })
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
