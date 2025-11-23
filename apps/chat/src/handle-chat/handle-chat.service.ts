import { friendship } from './../../../../libs/db/src/mongo/model/friendship.model';
import { REDISKEY } from '@app/constants/RedisKey';
import {
  CreateMessage,
  GetMsgFromRoomDTO,
  HandleDeleteAllDto,
  HandleDeleteDto,
  HandlePinDto,
  HandleReactDto,
  markReadUpToDto,
} from '@app/dto';
import Utils from '@app/helpers/utils';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Room,
  User,
  Message,
  RoomsState,
  MessageRead,
  RoomsUsersState,
  MessageReaction,
  MessageHide,
  Friendship,
  friendshipModel,
  callHistoryModel,
  CallHistory,
} from 'libs/db/src';
import { Model } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { buildMessageCorePipeline } from './Pipeline/getMsg';
import { Response } from '@app/helpers/response';

@Injectable()
export class HandleChatService {
  private readonly utils = Utils;
  private readonly key = REDISKEY;
  private readonly log = new Logger();
  constructor(
    @InjectModel('Room') private readonly roomModel: Model<Room>,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Message') private readonly messageModel: Model<Message>,
    @InjectModel('MessageRead')
    private readonly messageReadModel: Model<MessageRead>,
    @InjectModel('RoomsState')
    private readonly RoomsStateModel: Model<RoomsState>,
    private readonly roomService: RoomsService,
    @InjectModel('RoomsUsersState')
    private readonly RoomsUsersState: Model<RoomsUsersState>,
    @InjectModel('MessageReaction')
    private readonly messageReactionModel: Model<MessageReaction>,
    @InjectModel('MessageHide')
    private readonly messageHideModel: Model<MessageHide>,
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    @InjectModel(callHistoryModel.name)
    private readonly callHistoryModel: Model<CallHistory>,
  ) {}

  async createMessage(payload: CreateMessage) {
    const { roomId, userId, type, content, attachments, replyTo, id } = payload;

    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thể gửi tin nhắn');
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    // tiến hành xử lý chặn
    // chặn với nhắn tin private
    if (finInfo.room_type === 'private') {
      const ids = finInfo.room_members.map((m) => m.id);
      const frp_id = this.utils.pairRoomId(ids[0], ids[1]);
      const friendshipBocked = await this.friendshipModel.findOne({
        frp_id,
        frp_status: 'BLOCKED',
      });
      if (friendshipBocked) {
        throw new BadRequestException('bạn đã bị chặn');
      }
    } else {
      const checkGuest = finInfo.room_members.find(
        (m) => m.id === userInfo.usr_id && m.role === 'guest',
      );
      if (checkGuest) {
        throw new BadRequestException('bạn đã bị chặn');
      }
    }

    const data: {
      msg_roomId: typeof finInfo._id;
      msg_sender: ReturnType<typeof this.utils.convertToObjectIdMongoose>;
      msg_content: typeof content;
      reply_to: ReturnType<typeof this.utils.convertToObjectIdMongoose>;
      attachment_ids: any[];
      msg_type: typeof type;
      _id?: ReturnType<typeof this.utils.convertToObjectIdMongoose>;
    } = {
      msg_roomId: finInfo._id,
      msg_sender: this.utils.convertToObjectIdMongoose(userId),
      msg_content: content,
      reply_to: replyTo ? this.utils.convertToObjectIdMongoose(replyTo) : null,
      attachment_ids: Array.isArray(attachments)
        ? attachments.map((i) => this.utils.convertToObjectIdMongoose(i))
        : [],
      msg_type: type,
    };
    if (id) {
      data._id = this.utils.convertToObjectIdMongoose(id);
    }
    this.log.debug(data);
    // create new message (without transaction for standalone MongoDB)
    const createNewMsg = await this.messageModel.create(data);
    if (!createNewMsg) {
      throw new BadRequestException('không tạo được tin nhắn');
    }
    // Generate content snapshot based on message type
    let contentSnap: string;
    switch (type) {
      case 'text': {
        contentSnap = content || '[Tin nhắn rỗng]';
        break;
      }
      case 'image': {
        contentSnap = '[Hình ảnh]';
        break;
      }
      case 'file': {
        contentSnap = '[File đính kèm]';
        break;
      }
      case 'video': {
        contentSnap = '[Video]';
        break;
      }
      case 'audio': {
        contentSnap = '[Tin nhắn thoại]';
        break;
      }
      case 'gif': {
        contentSnap = 'Đã gửi file gif';
        break;
      }
      default: {
        contentSnap = content || '[Tin nhắn]';
        break;
      }
    }

    // Update message read and room state in parallel
    await Promise.all([
      this.messageReadModel.findOneAndUpdate(
        {
          room_id: finInfo._id,
          user_id: this.utils.convertToObjectIdMongoose(userId),
        },
        {
          msg_id: createNewMsg._id,
          uniq: `${createNewMsg._id.toString()}:${userId}`,
          readAt: createNewMsg.createdAt,
        },
        { upsert: true },
      ),
      this.RoomsStateModel.findOneAndUpdate(
        {
          room_id: finInfo._id,
        },
        {
          last_message_id: createNewMsg._id,
          'last_message_snapshot.content': contentSnap,
          'last_message_snapshot.sender_id':
            this.utils.convertToObjectIdMongoose(userId),
        },
        { upsert: true },
      ),
      this.RoomsUsersState.findOneAndUpdate(
        {
          room_id: finInfo._id,
          user_id: this.utils.convertToObjectIdMongoose(userId),
        },
        {
          last_read_msg_id: createNewMsg._id,
          last_read_at: createNewMsg.createdAt,
          unread_count: 0,
        },
        { upsert: true },
      ),
    ]);

    // Update unread count for other members
    const userMongoIds = finInfo.room_members
      .filter((i) => i.user_id.toString() !== userId)
      .map((i) => i.user_id.toString());
    await Promise.all(
      userMongoIds.map((i) =>
        this.recomputeUnreadForUserRoom(i, finInfo._id.toString()),
      ),
    );
    return Response.success(
      {
        msgId: createNewMsg._id.toString(),
        members: finInfo.room_members,
        roomId: finInfo.room_id,
      },
      'Tin nhắn mới thành công',
    );
  }
  private async recomputeUnreadForUserRoom(
    userId: string,
    roomMongoId: string,
  ) {
    const uid = this.utils.convertToObjectIdMongoose(userId);
    const rid = this.utils.convertToObjectIdMongoose(roomMongoId);

    // 1) Lấy con trỏ đọc
    const state = await this.RoomsUsersState.findOne(
      { room_id: rid, user_id: uid },
      { last_read_at: 1, clear_before_ts: 1 },
    ).lean();

    const lastAt = state?.last_read_at ?? null;
    const clearTs = state?.clear_before_ts ?? null;
    const baseTs =
      lastAt && clearTs
        ? lastAt > clearTs
          ? lastAt
          : clearTs
        : lastAt || clearTs || null;

    // 2) Đếm unread (exclude self, not deleted, > baseTs)
    const match: Record<string, unknown> = {
      msg_roomId: rid,
      msg_sender: { $ne: uid },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };
    if (baseTs) match.createdAt = { $gt: baseTs };

    // (A) BẢN NHANH:
    // const unread = await this.messageModel.countDocuments(match);

    // (B) BẢN CHUẨN: Trừ đi tin user đã Hide
    const agg: { cnt: number }[] = await this.messageModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'MessageHides',
          let: { mid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$msg_id', '$$mid'] },
                    { $eq: ['$user_id', uid] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'hiddenByMe',
        },
      },
      { $match: { hiddenByMe: { $size: 0 } } },
      { $count: 'cnt' },
    ]);
    const unread = agg.length > 0 ? agg[0].cnt : 0;

    // 3) Ghi vào RoomsUsersState
    const updated = await this.RoomsUsersState.findOneAndUpdate(
      { room_id: rid, user_id: uid },
      { $set: { unread_count: unread } },
      { new: true, upsert: true, projection: { unread_count: 1 } },
    ).lean();

    return { unread_count: updated?.unread_count ?? unread };
  }

  async getOneMsg(userId: string, msgId: string) {
    const pipeLine = buildMessageCorePipeline(userId);

    const result = await this.messageModel.aggregate([
      {
        $match: {
          _id: this.utils.convertToObjectIdMongoose(msgId),
        },
      },

      ...pipeLine,
    ]);
    return result[0] as Record<string, any>;
  }
  async markReadUpTo(payload: markReadUpToDto) {
    const { roomId, userId, lastMessageId } = payload;
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      this.log.error('User không thuộc room:', { userId, roomId });
      return {
        msgId: null,
        members: [],
        roomId: null,
      };
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      this.log.error('Người dùng không tồn tại:', userId);
      return {
        msgId: null,
        members: [],
        roomId: null,
      };
    }

    // get info room

    console.log(
      '🚀 ~ HandleChatService ~ markReadUpTo ~ lastMessageId:',
      lastMessageId,
    );
    const [messgeInfo, roomInfro] = await Promise.all([
      this.messageModel.findById(
        this.utils.convertToObjectIdMongoose(lastMessageId),
      ),
      this.roomModel.findOne({
        room_id: {
          $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
        },
      }),
    ]);

    if (!roomInfro) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    if (!messgeInfo) {
      throw new NotAcceptableException('tin nhắn không tồn tại');
    }
    const readAt = new Date();
    await Promise.all([
      this.messageReadModel.findOneAndUpdate(
        {
          room_id: roomInfro._id,
          user_id: userInfo._id,
        },
        {
          msg_id: messgeInfo._id,
          uniq: `${messgeInfo._id.toString()}:${userId}`,
          readAt: readAt,
        },
        { upsert: true },
      ),
      this.RoomsUsersState.findOneAndUpdate(
        {
          room_id: roomInfro._id,
          user_id: userInfo._id,
        },
        {
          last_read_msg_id: messgeInfo._id,
          last_read_at: readAt,
        },
      ),
    ]);

    await Promise.all(
      roomInfro.room_members.map((i) =>
        this.recomputeUnreadForUserRoom(
          i.user_id.toString(),
          roomInfro._id.toString(),
        ),
      ),
    );
    return Response.success(
      {
        msgId: messgeInfo._id.toString(),
        members: roomInfro.room_members,
        roomId: roomInfro.room_id,
      },
      'Đã đọc tin nhắn',
    );
  }

  async getMsgFromRoom({
    roomId,
    userId,
    limit = 100,
    type = null,
    msgId = null,
  }: GetMsgFromRoomDTO) {
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      this.log.error('User không thuộc room:', { userId, roomId });
      return {
        msgId: null,
        members: [],
        roomId: null,
      };
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      this.log.error('Người dùng không tồn tại:', userId);
      return {
        msgId: null,
        members: [],
        roomId: null,
      };
    }

    // get info room
    const roomInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!roomInfo) {
      throw new NotAcceptableException('Phòng không tồn taij');
    }

    // Build comparison filter based on pagination type
    const compare: Record<string, any> = {};
    if (type && msgId) {
      const msgObjectId = this.utils.convertToObjectIdMongoose(msgId);
      if (type === 'new') {
        // Load tin nhắn mới hơn msgId (để load real-time updates)
        compare._id = { $gt: msgObjectId };
      } else if (type === 'old') {
        // Load tin nhắn cũ hơn msgId (để pagination lùi về quá khứ)
        compare._id = { $lt: msgObjectId };
      }
    }

    const pipeLine = buildMessageCorePipeline(userId);
    const result = await this.messageModel.aggregate([
      {
        $match: {
          msg_roomId: roomInfo._id,
          ...compare,
        },
      },
      ...pipeLine,
      { $sort: { createdAt: -1 } }, // Sắp xếp giảm dần (mới nhất lên đầu)
      { $limit: Number(limit) }, // Giới hạn số lượng
      { $sort: { createdAt: 1 } }, // Đảo lại thứ tự tăng dần (cũ → mới)
    ]);
    return Response.success(result, 'Tin nhắn mới thành công');
  }

  async handleReact({ userId, roomId, msgId, emoji }: HandleReactDto) {
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thể gửi tin nhắn');
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    const findMsg = await this.messageModel.findById(msgId);
    if (!findMsg) {
      return Response.success(
        {
          msgId,
          members: finInfo.room_members,
          roomId: finInfo.room_id,
        },
        'Đã thả icon',
      );
    }
    let contentSnap: string;
    switch (findMsg?.msg_type) {
      case 'text': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về tin nhắn`;
        break;
      }
      case 'image': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về hình ảnh`;
        break;
      }
      case 'file': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về tệp đính kèm`;
        break;
      }
      case 'video': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về video`;
        break;
      }
      case 'audio': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về tin nhắn thoại`;
        break;
      }
      case 'gif': {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji} về gif`;
        break;
      }
      default: {
        contentSnap = `Đã bày tỏ cảm xúc ${emoji}`;
        break;
      }
    }
    await Promise.all([
      this.messageReactionModel.findOneAndUpdate(
        {
          room_id: finInfo._id,
          user_id: userInfo._id,
          msg_id: this.utils.convertToObjectIdMongoose(msgId),
        },
        {
          emoji,
          uniq: `${msgId}:${userId}:${emoji}`,
        },
        { upsert: true },
      ),
      this.RoomsStateModel.findOneAndUpdate(
        {
          room_id: finInfo._id,
        },
        {
          'last_message_snapshot.content': contentSnap,
          'last_message_snapshot.sender_id':
            this.utils.convertToObjectIdMongoose(userId),
        },
        { upsert: true },
      ),
    ]);
    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
      },
      'Đã thả icon',
    );
  }
  async handleGimMsg({ userId, roomId, msgId, pinned }: HandlePinDto) {
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thể gửi tin nhắn');
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    // Use $each inside $addToSet to avoid potential issues inserting a single value
    // and ensure we convert the incoming msgId to ObjectId consistently.
    const objectId = this.utils.convertToObjectIdMongoose(msgId);
    const updateQuery = pinned
      ? { $addToSet: { room_ghim: { $each: [objectId] } } }
      : { $pull: { room_ghim: objectId } };

    await Promise.all([
      this.messageModel.findOneAndUpdate(
        {
          msg_roomId: finInfo._id,
          _id: objectId,
        },
        {
          pinned,
        },
      ),
      // Return the updated room document (new: true). No upsert here.
      this.roomModel.findOneAndUpdate({ _id: finInfo._id }, updateQuery, {
        new: true,
      }),
    ]);
    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
      },
      'Đã ghim',
    );
  }

  async handleDeleteForUser({ userId, roomId, msgId }: HandleDeleteDto) {
    console.log('🚀 ~ HandleChatService ~ handleDeleteForUser ~ msgId:', msgId);
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thể gửi tin nhắn');
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    const findHiddne = await this.messageHideModel.findOne({
      room_id: finInfo._id,
      msg_id: this.utils.convertToObjectIdMongoose(msgId),
      user_id: userInfo._id,
      uniq: `${msgId}:${userId}`,
    });
    // update many
    const findMsg = await this.messageModel
      .find({
        reply_to: this.utils.convertToObjectIdMongoose(msgId),
      })
      .select('_id');
    const msgIds = findMsg.map((i) => i._id.toHexString());
    msgIds.push(msgId);
    if (findHiddne) {
      return Response.success(
        {
          msgIds,
          members: finInfo.room_members,
          roomId: finInfo.room_id,
        },
        'Đã Xoá tin Nhắn',
      );
    }
    await this.messageHideModel.create({
      room_id: finInfo._id,
      msg_id: this.utils.convertToObjectIdMongoose(msgId),
      user_id: userInfo._id,
      uniq: `${msgId}:${userId}`,
    });
    console.log('result');
    return Response.success(
      {
        msgIds,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
      },
      'Đã Xoá tin Nhắn',
    );
  }

  async handleDelete({
    userId,
    roomId,
    msgId,
    placeholder,
  }: HandleDeleteAllDto) {
    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thể gửi tin nhắn');
    }
    //check user
    const userInfo = await this.roomService.getUserInfo(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    const findMsg = await this.messageModel
      .find({
        reply_to: this.utils.convertToObjectIdMongoose(msgId),
      })
      .select('_id');
    const msgIds = findMsg.map((i) => i._id.toHexString());
    msgIds.push(msgId);
    // Update the message as deleted and recompute unread counts for all members in parallel
    const updatePromise = this.messageModel.findOneAndUpdate(
      {
        _id: this.utils.convertToObjectIdMongoose(msgId),
        msg_roomId: finInfo._id,
      },
      {
        deletedBy: userInfo._id,
        deletedAt: new Date(),
        placeholder,
        msg_content: '',
        msg_content_norm: '',
      },
    );

    const recomputePromises = finInfo.room_members.map((m) =>
      this.recomputeUnreadForUserRoom(
        m.user_id.toString(),
        finInfo._id.toString(),
      ),
    );

    await Promise.all([updatePromise, Promise.all(recomputePromises)]);

    return Response.success(
      {
        msgIds,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
      },
      'Đã thu hồi tin nhắn',
    );
  }

  // bắt đầu cuộc gọi
  async startCall({ callerId, calleeId, roomId, callType }: any) {
    const caller = await this.userModel.findById(callerId);
    if (!caller) {
      throw new NotFoundException('Người gọi cuộc gọi không tồn tại');
    }
    const callee = await this.userModel.findById(calleeId);
    if (!callee) {
      throw new NotFoundException('Người nhận cuộc gọi không tồn tại');
    }

    const room = await this.roomModel.findById(roomId);
    if (!room) {
      throw new NotFoundException('Phòng gọi không tồn tại');
    }

    const callHistory = await this.callHistoryModel.create({
      caller_id: caller._id,
      callee_id: callee._id,
      room_id: room._id,
      call_type: callType,
      status: 'initiated',
      started_at: new Date(),
    });
    if (!callHistory) {
      throw new BadRequestException('Không tạo được lịch sử cuộc gọi');
    }
    return Response.success(callHistory, 'Cuộc gọi đã được tạo');
  }

  // trả lời cuộc gọi
  async answerCall({ callerId, calleeId, roomId }: any) {
    const caller = await this.userModel.findById(callerId);
    if (!caller) {
      throw new NotFoundException('Người gọi cuộc gọi không tồn tại');
    }
    const callee = await this.userModel.findById(calleeId);
    if (!callee) {
      throw new NotFoundException('Người nhận cuộc gọi không tồn tại');
    }
    const room = await this.roomModel.findById(roomId);
    if (!room) {
      throw new NotFoundException('Phòng gọi không tồn tại');
    }
    const callHistory = await this.callHistoryModel.findOneAndUpdate(
      {
        caller_id: caller._id,
        callee_id: callee._id,
        room_id: room._id,
        status: 'answered',
      },
      {
        status: 'answered',
        answered_at: new Date(),
      },
    );
    if (!callHistory) {
      throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
    }
    return Response.success(callHistory, 'Cuộc gọi đã được trả lời');
  }

  // kết thúc cuộc gọi
  async endCall({ callerId, calleeId, roomId, type }: any) {
    const caller = await this.userModel.findById(callerId);
    const callee = await this.userModel.findById(calleeId);
    const room = await this.roomModel.findById(roomId);
    if (!caller || !callee || !room) {
      throw new NotFoundException(
        'Người gọi hoặc người nhận cuộc gọi không tồn tại',
      );
    }

    const callHistory = await this.callHistoryModel.findOneAndUpdate(
      {
        caller_id: caller._id,
        callee_id: callee._id,
        room_id: room._id,
        status: { $in: ['initiated', 'answered'] }, // trạng thái cuộc gọi đã bắt đầu hoặc đã trả lời
      },
      {
        status: type,
        ended_by: caller._id,
        end_reason: 'normal',
        ended_at: new Date(),
      },
    );
    if (!callHistory) {
      throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
    }
    return Response.success(callHistory, 'Cuộc gọi đã được kết thúc');
  }

  // lấy lịch sử cuộc gọi theo ID người dùng và ID phòng gọi
  async getCallHistoryByUserId(
    userId: string,
    roomId: string,
    type: 'caller' | 'callee',
  ) {
    const callHistory = await this.callHistoryModel
      .find({
        [type === 'caller' ? 'caller_id' : 'callee_id']: userId,
        room_id: roomId,
      })
      .sort({ createdAt: -1 });
    return Response.success(callHistory, 'Lịch sử cuộc gọi đã được lấy');
  }
}
