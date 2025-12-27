import {
  CreateMessage,
  GetDocumentsFromRoomDTO,
  GetMsgFromRoomDTO,
  HandleDeleteAllDto,
  HandleDeleteDto,
  HandlePinDto,
  HandleReactDto,
  markReadUpToDto,
  RequestCallDto,
  AcceptCallDto,
  EndCallDto,
} from '@app/dto';
import Utils from '@app/helpers/utils';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Room,
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
  Attachment,
  User,
} from 'libs/db/src';
import { Model, Types } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { buildMessageCorePipeline } from './Pipeline/getMsg';
import { Response } from '@app/helpers/response';
import { MemberStatus } from 'libs/db/src/mongo/model/call-history.model';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent } from '@app/dto/enum.type';

@Injectable()
export class HandleChatService {
  private readonly utils = Utils;

  private readonly log = new Logger();
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(MessageRead.name)
    private readonly messageReadModel: Model<MessageRead>,
    @InjectModel(RoomsState.name)
    private readonly RoomsStateModel: Model<RoomsState>,
    private readonly roomService: RoomsService,
    @InjectModel(RoomsUsersState.name)
    private readonly RoomsUsersState: Model<RoomsUsersState>,
    @InjectModel(MessageReaction.name)
    private readonly messageReactionModel: Model<MessageReaction>,
    @InjectModel(MessageHide.name)
    private readonly messageHideModel: Model<MessageHide>,
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    @InjectModel(callHistoryModel.name)
    private readonly callHistoryModel: Model<CallHistory>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @Inject(SERVICES.AI)
    private readonly aiClient: ClientKafka,
    @Inject(SERVICES.FILESYSTEM)
    private readonly fileClient: ClientKafka,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  async createMessage(payload: CreateMessage) {
    const {
      roomId,
      userId,
      type,
      content,
      attachments,
      replyTo,
      id,
      documentId,
    } = payload;

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
        (m) =>
          m.user_id.toString() === userInfo._id.toString() &&
          m.role === 'guest',
      );
      if (checkGuest) {
        throw new BadRequestException('Bạn chỉ có quyền xem');
      }
    }

    const messageId = id
      ? this.utils.convertToObjectIdMongoose(id)
      : new Types.ObjectId();

    const updatePayload = {
      msg_roomId: finInfo._id,
      msg_sender: this.utils.convertToObjectIdMongoose(userId),
      msg_content: content || '',
      reply_to: replyTo ? this.utils.convertToObjectIdMongoose(replyTo) : null,
      attachment_ids: Array.isArray(attachments)
        ? attachments.map((i) => this.utils.convertToObjectIdMongoose(i))
        : [],
      msg_type: type,
      document_id: documentId
        ? this.utils.convertToObjectIdMongoose(documentId)
        : null,
    };

    // Upsert message: if an _id is provided and exists, update it; otherwise insert new
    const createNewMsg = await this.messageModel.findOneAndUpdate(
      { _id: messageId },
      { $set: updatePayload },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    );

    if (!createNewMsg) {
      throw new BadRequestException('không tạo được tin nhắn');
    }
    // Generate content snapshot based on message type
    let contentSnap: string;
    switch (type) {
      case 'image': {
        contentSnap = '[Hình ảnh]';
        break;
      }
      case 'file': {
        contentSnap = '[File đính kèm]';
        break;
      }
      case 'document': {
        contentSnap = '[Tài liệu]';
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
    await Promise.allSettled([
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
      ...(type === 'text'
        ? [
            this.utils.dispatchEventKafka(
              this.aiClient,
              KafkaEvent.AI_CHAT_MSG_EMBEDDING,
              {
                text: content,
                roomId: finInfo._id,
                messageId: createNewMsg._id,
              },
            ),
          ]
        : []),
      ...(content && /(https?:\/\/[^\s]+)/g.test(content)
        ? [
            this.utils.dispatchEventKafka(
              this.fileClient,
              KafkaEvent.PROCESS_LINK,
              {
                content,
                userId,
                roomId: finInfo._id.toString(),
                messageId: createNewMsg._id.toString(),
              },
            ),
          ]
        : []),
      ...(documentId
        ? [
            this.utils.dispatchEventKafka(
              this.fileClient,
              KafkaEvent.SHARE_DOC_FOR_ROOM,
              {
                roomId,
                userId,
                docId: documentId,
              },
            ),
          ]
        : []),
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
    if (type && msgId && Types.ObjectId.isValid(msgId)) {
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

  async getDocumentsFromRoom({
    roomId,
    userId,
    limit = 20,
    page = 1,
    type,
  }: GetDocumentsFromRoomDTO) {
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

    const skip = (page - 1) * limit;
    const pipeLine = buildMessageCorePipeline(userId);

    const matchStage: Record<string, any> = {
      msg_roomId: roomInfo._id,
    };

    if (type === 'media') {
      matchStage.msg_type = { $in: ['image', 'video', 'audio'] };
    } else if (type) {
      matchStage.msg_type = type;
    } else {
      matchStage.msg_type = 'document';
    }

    const result = await this.messageModel.aggregate([
      {
        $match: matchStage,
      },
      ...pipeLine,
      { $sort: { createdAt: -1 } },
      { $skip: Number(skip) },
      { $limit: Number(limit) },
    ]);
    return Response.success(result, 'Lấy danh sách tài liệu thành công');
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

    // Check permission: Only Sender or Admin can delete
    const targetMsg = await this.messageModel.findOne({
      _id: this.utils.convertToObjectIdMongoose(msgId),
      msg_roomId: finInfo._id,
    });
    if (!targetMsg) throw new NotFoundException('Tin nhắn không tồn tại');

    const isSender =
      targetMsg.msg_sender.toString() === userInfo._id.toString();
    const currentMember = finInfo.room_members.find(
      (m) => m.user_id.toString() === userId,
    );
    const isAdmin = currentMember?.role === 'admin';

    if (!isSender && !isAdmin) {
      throw new BadRequestException('Bạn không có quyền xoá tin nhắn này');
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
  async requestCall({
    actionUserId,
    membersIds,
    roomId,
    callType,
    messageId,
  }: RequestCallDto) {
    console.log(
      '🚀 ~ HandleChatService ~ requestCall ~ membersIds:',
      membersIds,
    );
    console.log('🚀 ~ HandleChatService ~ requestCall ~ roomId:', roomId);
    try {
      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });
      if (!actionUser) {
        throw new NotFoundException('Người bắt đầu cuộc gọi không tồn tại');
      }
      const members = await this.userModel.find({
        usr_id: {
          $in: membersIds.map((m) => m.toString()),
        },
      });

      const room = await this.roomModel.findOne({ room_id: roomId });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      const membersData = members.map((m) => ({
        user_id: m._id,
        id: m.usr_id,
        fullname: m.usr_fullname,
        avatar: m.usr_avatar,
        is_caller: m.usr_id === actionUserId,
        status:
          m.usr_id === actionUserId ? 'started' : ('pending' as MemberStatus),
      }));

      const callHistory = await this.callHistoryModel.create({
        members: membersData,
        room_id: room._id,
        call_type: callType,
        started_at: new Date(),
        message_id: messageId
          ? this.utils.convertToObjectIdMongoose(messageId)
          : null,
      });

      if (!callHistory) {
        throw new BadRequestException('Không tạo được lịch sử cuộc gọi');
      }

      return Response.success(
        {
          history: callHistory,
          room: room,
          callType: callType,
        },
        'Cuộc gọi đã được tạo',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ startCall ~ error:', error);
      throw new BadRequestException('Không tạo được lịch sử cuộc gọi');
    }
  }

  // trả lời cuộc gọi
  async acceptCall({ actionUserId, membersIds, roomId }: AcceptCallDto) {
    try {
      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });

      if (!actionUser) {
        throw new NotFoundException('Người dùng không tồn tại');
      }

      const room = await this.roomModel.findOne({ room_id: roomId });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      const callHistory = await this.callHistoryModel.findOne({
        members: {
          $elemMatch: { id: actionUser.usr_id },
        },
        room_id: room._id,
      });

      if (!callHistory) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      const updatedMembers = callHistory.members.map((m) => {
        // So sánh ObjectId đúng cách
        const isMatch = m.id.toString() === actionUser.usr_id.toString();
        const shouldStart = isMatch || (m.is_caller && m.status === 'pending');
        return {
          ...m,
          status: shouldStart ? ('started' as MemberStatus) : m.status,
        };
      });

      await this.callHistoryModel.updateOne(
        { _id: callHistory._id },
        { $set: { members: updatedMembers, started_at: new Date() } },
      );

      const refreshedHistory = await this.callHistoryModel.findById(
        callHistory._id,
      );

      if (!refreshedHistory) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      return Response.success(
        {
          history: refreshedHistory,
          room: room,
        },
        'Cuộc gọi đã được trả lời. Bắt đầu cuộc gọi',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ acceptCall ~ error:', error);
      throw new BadRequestException('Không trả lời được cuộc gọi');
    }
  }

  // kết thúc cuộc gọi
  async endCall({ actionUserId, roomId, status }: EndCallDto) {
    try {
      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });
      if (!actionUser) {
        throw new NotFoundException('Người dùng không tồn tại');
      }

      const room = await this.roomModel.findOne({ room_id: roomId });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      const callHistory = await this.callHistoryModel.findOne({
        members: {
          $elemMatch: { id: actionUser.usr_id },
        },
        room_id: room._id,
      });

      if (!callHistory) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      const totalMembers = callHistory.members.length;

      // Cập nhật status cho member hiện tại
      callHistory.members = callHistory.members.map((m) => {
        // So sánh ObjectId đúng cách
        const isMatch = m.id.toString() === actionUser.usr_id.toString();
        return {
          ...m,
          status: isMatch ? status : totalMembers === 2 ? 'ended' : m.status,
        };
      });

      // Tính lại totalMembersEnded sau khi cập nhật
      const totalMembersEnded = callHistory.members.filter(
        (m) =>
          m.status === 'ended' ||
          m.status === 'missed' ||
          m.status === 'rejected' ||
          m.status === 'cancelled',
      ).length;

      callHistory.ended_at =
        totalMembersEnded === totalMembers ? new Date() : null;

      // Đánh dấu mảng members đã thay đổi để Mongoose nhận diện
      callHistory.markModified('members');
      await callHistory.save();

      return Response.success(
        {
          history: callHistory,
          room: room,
        },
        'Cuộc gọi đã được kết thúc',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ endCall ~ error:', error);
      throw new BadRequestException('Không kết thúc được cuộc gọi');
    }
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
