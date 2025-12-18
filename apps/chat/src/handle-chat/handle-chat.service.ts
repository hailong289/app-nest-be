import {
  CreateMessage,
  GetDocumentsFromRoomDTO,
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
  Attachment,
} from 'libs/db/src';
import { Model } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { buildMessageCorePipeline } from './Pipeline/getMsg';
import { Response } from '@app/helpers/response';
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
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @Inject(SERVICES.AI)
    private readonly aiClient: ClientKafka,
    @Inject(SERVICES.FILESYSTEM)
    private readonly fileClient: ClientKafka,
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

    const data: {
      msg_roomId: typeof finInfo._id;
      msg_sender: ReturnType<typeof this.utils.convertToObjectIdMongoose>;
      msg_content: typeof content;
      reply_to: ReturnType<typeof this.utils.convertToObjectIdMongoose>;
      attachment_ids: any[];
      msg_type: typeof type;
      document_id?: any;
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
      document_id: documentId
        ? this.utils.convertToObjectIdMongoose(documentId)
        : null,
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
      ...(type === 'text'
        ? [
            this.utils.dispatchEventKafka(this.aiClient, KafkaEvent.aiMsg, {
              text: content,
              roomId: finInfo._id,
              messageId: createNewMsg._id,
            }),
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

    // Process links asynchronously via Kafka
    if (content && /(https?:\/\/[^\s]+)/g.test(content)) {
      console.log('link', content);
      await this.utils.dispatchEventKafka(
        this.fileClient,
        KafkaEvent.processLink,
        {
          content,
          userId,
          roomId: finInfo._id.toString(),
          messageId: createNewMsg._id.toString(),
        },
      );
    }

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
}
