import {
  CreateMessage,
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
  OnModuleInit,
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
} from 'libs/db/src';
import { Model, Types } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { UserCacheService } from '../cache/user-cache.service';
import {
  buildMessageCorePipeline,
  buildMessageDetailPipeline,
  buildMessagesDetailPipeline,
  hydrateMessages,
  AuthGrpcClient,
  FileSystemGrpcClient,
  AIGrpcClient,
  LearningGrpcClient,
} from './Pipeline/getMsg';
import { Response } from '@app/helpers/response';
import { MemberStatus } from 'libs/db/src/mongo/model/call-history.model';
import { ClientKafka } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent, notifyType } from '@app/dto/enum.type';
import { RoomType } from 'libs/db/src/mongo/model/room.model';
import { firstValueFrom } from 'rxjs';

type GrpcResponse<T = any> = {
  statusCode?: number;
  metadata?: T;
};

@Injectable()
export class HandleChatService implements OnModuleInit {
  private readonly utils = Utils;

  private readonly log = new Logger();

  // gRPC clients for cross-service database isolation hydration
  private authGrpcClient: AuthGrpcClient;
  private filesystemGrpcClient: FileSystemGrpcClient;
  private aiGrpcClient: AIGrpcClient;
  private learningGrpcClient: LearningGrpcClient;

  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(MessageRead.name)
    private readonly messageReadModel: Model<MessageRead>,
    @InjectModel(RoomsState.name)
    private readonly RoomsStateModel: Model<RoomsState>,
    private readonly roomService: RoomsService,
    private readonly userCache: UserCacheService,
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
    @Inject(SERVICES.AI)
    private readonly aiClient: ClientKafka,
    @Inject(SERVICES.FILESYSTEM)
    private readonly fileClient: ClientKafka,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
    @Inject('FILESYSTEM_GRPC')
    private readonly filesystemGrpc: ClientGrpc,
    @Inject('AI_GRPC')
    private readonly aiGrpc: ClientGrpc,
    @Inject(SERVICES.LEARNING)
    private readonly learningGrpc: ClientGrpc,
  ) {}

  onModuleInit() {
    this.authGrpcClient = this.authGrpc.getService<AuthGrpcClient>('AuthService');
    this.filesystemGrpcClient =
      this.filesystemGrpc.getService<FileSystemGrpcClient>('FileSystemService');
    this.aiGrpcClient = this.aiGrpc.getService<AIGrpcClient>('AIService');
    // Learning gRPC combines three separate proto services
    const quizzSvc = this.learningGrpc.getService<any>('QuizzService');
    const flashcardSvc = this.learningGrpc.getService<any>('FlashcardService');
    const todoSvc = this.learningGrpc.getService<any>('TodoService');
    this.learningGrpcClient = {
      GetQuizzesByIds: (data: any) => quizzSvc.GetQuizzesByIds(data),
      GetFlashcardsByIds: (data: any) => flashcardSvc.GetFlashcardsByIds(data),
      GetTodoProjectsByIds: (data: any) => todoSvc.GetTodoProjectsByIds(data),
    } as LearningGrpcClient;
  }

  /**
   * Post-aggregate hydration helper: calls hydrateMessages with all gRPC clients.
   * Every message aggregation pipeline result should pass through this method
   * before being returned to callers.
   */
  private async hydrateMsgs(messages: any[]): Promise<any[]> {
    if (!messages || messages.length === 0) return messages;
    return hydrateMessages(messages, {
      authGrpc: this.authGrpcClient,
      filesystemGrpc: this.filesystemGrpcClient,
      aiGrpc: this.aiGrpcClient,
      learningGrpc: this.learningGrpcClient,
      // Use cached user hydration to reduce gRPC calls during scroll.
      getUsersByIds: (userIds) => this.userCache.getUsersByIdsCached(userIds),
    });
  }

  private toChatUser(u: Record<string, any> | null | undefined) {
    if (!u) return null;
    return {
      ...u,
      _id: u._id ?? u.id ?? '',
      usr_id: u.usr_id ?? u.id ?? u._id ?? '',
      usr_fullname: u.usr_fullname ?? u.fullname ?? '',
      usr_avatar: u.usr_avatar ?? u.avatar ?? '',
      usr_email: u.usr_email ?? u.email ?? '',
      usr_phone: u.usr_phone ?? u.phone ?? '',
    };
  }

  private async lookupUsersByIds(userIds: string[]) {
    if (!userIds.length) return [];
    const result = (await firstValueFrom(
      this.authGrpcClient.GetUsersByIds({ userIds }),
    )) as GrpcResponse<Record<string, any>[]>;
    return (result.metadata ?? [])
      .map((u) => this.toChatUser(u))
      .filter(Boolean) as Record<string, any>[];
  }

  private async lookupUserById(userId: string) {
    const users = await this.lookupUsersByIds([userId]);
    return users[0] ?? null;
  }

  private async lookupTodoProjectObjectId(todoProjectId: string) {
    const result = (await firstValueFrom(
      this.learningGrpcClient.GetTodoProjectsByIds({
        todoProjectIds: [todoProjectId],
      }),
    )) as GrpcResponse<Record<string, any>[]>;
    const project = result.metadata?.[0];
    return project?.id ?? project?._id ?? null;
  }

  /**
   * Convert `room_event.payload` (arbitrary object) to `payloadJson` (string)
   * so it survives gRPC serialization (proto schema only has `payloadJson`).
   * The realtime Socket.IO path doesn't need this — it carries raw JSON —
   * but we apply uniformly for consistency, and the FE handler unwraps both
   * shapes. Mutates and returns the message.
   */
  private serializeRoomEvent<T extends Record<string, unknown>>(msg: T): T {
    const ev = (msg as Record<string, unknown>)?.room_event as
      | Record<string, unknown>
      | null
      | undefined;
    if (!ev) return msg;
    if (
      ev.payload != null &&
      typeof ev.payload === 'object' &&
      ev.payloadJson === undefined
    ) {
      try {
        ev.payloadJson = JSON.stringify(ev.payload);
      } catch {
        ev.payloadJson = '';
      }
    }
    return msg;
  }

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
      quizId,
      flashcardId,
      todoProjectId,
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
      quiz_id: quizId ? this.utils.convertToObjectIdMongoose(quizId) : null,
      flashcard_id: flashcardId
        ? this.utils.convertToObjectIdMongoose(flashcardId)
        : null,
      todo_project_id: null as Types.ObjectId | null,
    };

    if (todoProjectId) {
      const todoProjectObjectId =
        await this.lookupTodoProjectObjectId(todoProjectId);
      if (!todoProjectObjectId) {
        throw new NotFoundException('Dự án không tồn tại');
      }
      updatePayload.todo_project_id =
        this.utils.convertToObjectIdMongoose(todoProjectObjectId);
    }

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
    const msg = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessageDetailPipeline(createNewMsg._id.toString()),
      ),
    );
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
      case 'quiz': {
        contentSnap = '[Bài kiểm tra]';
        break;
      }
      default: {
        contentSnap = content || '[Tin nhắn]';
        break;
      }
    }
    const roomUserState = await this.RoomsUsersState.find({
      room_id: finInfo._id,
      user_id: {
        $in: finInfo.room_members
          .filter((i) => i.user_id != userInfo._id)
          .map((m) => m.user_id),
      },
      muted: false,
    }).select('user_id');

    const userMongoIds = finInfo.room_members
      .filter((i) => i.user_id.toString() !== userId)
      .map((i) => i.user_id.toString());
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
                messageId: createNewMsg._id.toString(),
              },
            ),
          ]
        : []),
      this.utils.dispatchEventKafka(
        this.notificationClient,
        KafkaEvent.PUSH_NOTIFICATION_USERS,
        {
          userIds: roomUserState.map((i) => i.user_id),
          title:
            finInfo.room_type === RoomType.Private
              ? userInfo.usr_fullname
              : `${finInfo.room_name} : ${userInfo.usr_fullname}`,
          message: contentSnap,
          data: {
            type: notifyType.noify_new_message,
            push_type: 'message',
            msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
          },
        },
      ),
      ...userMongoIds.map(
        async (i) =>
          await this.recomputeUnreadForUserRoom(i, finInfo._id.toString()),
      ),
    ]);

    return Response.success(
      {
        msgId: createNewMsg._id.toString(),
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
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

    const match: Record<string, unknown> = {
      msg_roomId: rid,
      msg_sender: { $ne: uid },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };
    if (baseTs) match.createdAt = { $gt: baseTs };

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
    const [msg] = await this.hydrateMsgs(result);
    return msg ? this.serializeRoomEvent(msg) : msg;
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
    const msg = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessageDetailPipeline(messgeInfo._id.toString()),
      ),
    );
    return Response.success(
      {
        msgId: messgeInfo._id.toString(),
        members: roomInfro.room_members,
        roomId: roomInfro.room_id,
        msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
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
    // Hydrate cross-DB references, then stringify room_event.payload for gRPC.
    const hydrated = await this.hydrateMsgs(result);
    const serialized = (hydrated as Record<string, any>[]).map((m) =>
      this.serializeRoomEvent(m),
    );
    return Response.success(serialized, 'Tin nhắn mới thành công');
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
      throw new NotAcceptableException('Tin nhắn không tồn tại');
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
          uniq: `${finInfo._id.toString()}:${msgId}:${userId}`,
        },
        {
          emoji,
          room_id: finInfo._id,
          user_id: userInfo._id,
          msg_id: this.utils.convertToObjectIdMongoose(msgId),
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
    const msg = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessageDetailPipeline(msgId),
      ),
    );
    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
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
    const msg = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessageDetailPipeline(msgId),
      ),
    );
    // Notify clients to refresh room info (pinned messages updated).
    // Lightweight ping — pin events already surface via MSGPINNED, this just
    // nudges the room metadata.
    this.roomService.notifyRoomChanged(finInfo.room_id.toString(), {
      reason: 'pinned-changed',
      messageId: msgId,
      pinned,
    });

    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
      },
      'Đã ghim',
    );
  }

  async handleDeleteForUser({ userId, roomId, msgId }: HandleDeleteDto) {
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
    await this.messageHideModel.findOneAndUpdate(
      {
        uniq: `${finInfo._id.toString()}:${msgId}:${userId}`,
      },
      {
        room_id: finInfo._id,
        msg_id: this.utils.convertToObjectIdMongoose(msgId),
        user_id: userInfo._id,
        uniq: `${finInfo._id.toString()}:${msgId}:${userId}`,
      },
    );
    // update many
    const findMsg = await this.messageModel
      .find({
        reply_to: this.utils.convertToObjectIdMongoose(msgId),
      })
      .select('_id');
    const msgIds = findMsg.map((i) => i._id.toHexString());
    msgIds.push(msgId);
    const msgs = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessagesDetailPipeline(msgIds),
      ),
    );
    return Response.success(
      {
        msgs,
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

    const msgs = await this.hydrateMsgs(
      await this.messageModel.aggregate(
        buildMessagesDetailPipeline(msgIds),
      ),
    );
    return Response.success(
      {
        msgs,
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
  }: RequestCallDto) {
    try {
      const room = await this.roomModel.findOne({ room_id: roomId });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      const actionUser = await this.lookupUserById(actionUserId);
      if (!actionUser) {
        throw new NotFoundException('Người bắt đầu cuộc gọi không tồn tại');
      }

      const msg = await this.messageModel.create({
        msg_roomId: room._id,
        msg_sender: actionUser._id,
        msg_type: 'call',
        msg_content: '',
        attachment_ids: [],
        reply_to: null,
      });

      if (!msg) {
        throw new BadRequestException('Không tạo được tin nhắn cuộc gọi');
      }

      const members = await this.lookupUsersByIds(
        membersIds.map((m) => m.toString()),
      );

      const membersData = members.map((m) => ({
        user_id: m._id,
        id: m.usr_id,
        fullname: m.usr_fullname,
        avatar: m.usr_avatar,
        is_caller: m.usr_id === actionUserId,
        status:
          m.usr_id === actionUserId ? 'started' : ('pending' as MemberStatus),
      }));

      // Group rooms always use SFU; private rooms use P2P
      const callMode = room.room_type === 'private' ? 'p2p' : 'sfu';

      const callHistory = await this.callHistoryModel.create({
        members: membersData,
        room_id: room._id,
        call_type: callType,
        call_mode: callMode,
        started_at: new Date(),
        message_id: msg._id,
      });

      if (!callHistory) {
        throw new BadRequestException('Không tạo được lịch sử cuộc gọi');
      }

      // Group call → log a system event so non-call members see "X started a
      // group call" inline in chat. Skip for private/p2p (1-1) calls.
      if (callMode === 'sfu') {
        await this.roomService
          .writeLogRoom({
            event_type: 'call.started',
            room_id: room._id,
            actor_id: actionUser._id,
            targets: members.map((m) => m._id),
            placeholder: `${actionUser.usr_fullname} đã bắt đầu cuộc gọi ${
              callType === 'video' ? 'video' : 'thoại'
            } nhóm`,
            payload: {
              callId: callHistory.call_id,
              callType,
              callMode,
              callMessageId: msg._id.toString(),
              startedAt: callHistory.started_at,
            },
          })
          .catch((err) =>
            this.log.error(
              `[CALL_LOG] Failed to log call.started: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }

      const message = await this.hydrateMsgs(
        await this.messageModel.aggregate(
          buildMessageDetailPipeline(msg._id.toString()),
        ),
      );
      return Response.success(
        {
          history: callHistory,
          room: room,
          callType: callType,
          callMode: callMode,
          msg: message[0] as Record<string, any>,
        },
        'Cuộc gọi đã được tạo',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ startCall ~ error:', error);
      return Response.badRequest('Không tạo được lịch sử cuộc gọi');
    }
  }

  // trả lời cuộc gọi
  async acceptCall({ actionUserId, roomId, callId }: AcceptCallDto) {
    try {
      const actionUser = await this.lookupUserById(actionUserId);

      if (!actionUser) {
        throw new NotFoundException('Người dùng không tồn tại');
      }

      // roomId may be the custom room_id string OR the MongoDB _id (ObjectId string)
      // from buildMessageDetailPipeline which projects roomId as msg_roomId (ObjectId)
      const room = await this.roomModel.findOne({
        $or: [
          { room_id: roomId },
          ...(Types.ObjectId.isValid(roomId)
            ? [{ _id: new Types.ObjectId(roomId) }]
            : []),
        ],
      });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      const callHistory = await this.callHistoryModel.findOne({
        room_id: room._id,
        call_id: callId,
      });

      if (!callHistory) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      // Capture the user's status BEFORE we flip it to 'started'. We only want
      // to log a "joined" system message on the first transition (pending →
      // started), not on every reconnect/accept retry.
      const previousStatus = callHistory.members.find(
        (m) => m.id.toString() === actionUser.usr_id.toString(),
      )?.status;
      const isFirstJoin = previousStatus === 'pending';

      // Dùng findOneAndUpdate thay vì save() để tránh Mongoose VersionError khi
      // nhiều request đồng thời cùng cập nhật document (optimistic locking conflict).
      const updateFields: Record<string, any> = {
        'members.$[member].status': 'started',
      };
      if (!callHistory.started_at) {
        updateFields.started_at = new Date();
      }

      const refreshedHistory = await this.callHistoryModel.findOneAndUpdate(
        { room_id: room._id, call_id: callId },
        { $set: updateFields },
        {
          new: true,
          arrayFilters: [{ 'member.id': actionUser.usr_id.toString() }],
        },
      );

      if (!refreshedHistory) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      // Group calls log "X joined the call" once per member, on first join only.
      if (refreshedHistory.call_mode === 'sfu' && isFirstJoin) {
        await this.roomService
          .writeLogRoom({
            event_type: 'call.joined',
            room_id: room._id,
            actor_id: actionUser._id,
            targets: refreshedHistory.members.map((m) => m.user_id),
            placeholder: `${actionUser.usr_fullname} đã tham gia cuộc gọi`,
            payload: {
              callId: refreshedHistory.call_id,
              callMode: refreshedHistory.call_mode,
              callMessageId: refreshedHistory.message_id?.toString(),
            },
          })
          .catch((err) =>
            this.log.error(
              `[CALL_LOG] Failed to log call.joined: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }

      const msg = await this.hydrateMsgs(
        await this.messageModel.aggregate(
          buildMessageDetailPipeline(refreshedHistory.message_id.toString()),
        ),
      );
      return Response.success(
        {
          history: refreshedHistory,
          room: room,
          msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
          // Surface call_mode to the gateway so handleAccept can route
          // correctly (p2p → forward offer to caller, sfu → emit
          // member-joined). Without this, the field was undefined and
          // the gateway always took the p2p else-branch, which broke
          // group-call signal propagation.
          callMode: refreshedHistory.call_mode,
        },
        'Cuộc gọi đã được trả lời. Bắt đầu cuộc gọi',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ acceptCall ~ error:', error);
      return Response.badRequest('Không trả lời được cuộc gọi');
    }
  }

  // kết thúc cuộc gọi
  async endCall({ actionUserId, roomId, status, callId }: EndCallDto) {
    try {
      const actionUser = await this.lookupUserById(actionUserId);
      if (!actionUser) {
        throw new NotFoundException('Người dùng không tồn tại');
      }

      // roomId may be custom room_id string OR MongoDB _id (ObjectId string)
      const room = await this.roomModel.findOne({
        $or: [
          { room_id: roomId },
          ...(Types.ObjectId.isValid(roomId)
            ? [{ _id: new Types.ObjectId(roomId) }]
            : []),
        ],
      });
      if (!room) {
        throw new NotFoundException('Phòng gọi không tồn tại');
      }

      let callHistory = await this.callHistoryModel.findOne({
        room_id: room._id,
        call_id: callId,
      });

      if (!callHistory && !callId) {
        // Trường hợp không có callId, tìm cuộc gọi gần nhất đang diễn ra trong phòng này
        callHistory = await this.callHistoryModel
          .findOne({
            room_id: room._id,
            ended_at: null,
          })
          .sort({ createdAt: -1 });
      }

      if (!callHistory) {
        // Nếu vẫn không tìm thấy và status là cancelled, có thể bỏ qua lỗi này
        if (status === 'cancelled' || status === 'ended') {
          return Response.success(null, 'Không tìm thấy cuộc gọi để kết thúc');
        }
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      // call_mode là single source of truth cho "p2p hay group":
      //   - sfu  → group call. Cuộc gọi nhóm 2-người-cùng-team vẫn là
      //           sfu, đếm members.length không đáng tin.
      //   - p2p  → 1-1 (private room). Bất kỳ ai end là cuộc gọi tắt.
      const isGroupCall = callHistory.call_mode === 'sfu';

      // Capture actor's status BEFORE the flip — needed to distinguish
      // "genuinely joined-then-left" from "popup briefly opened but
      // never accepted into media". Only the former should emit
      // "X đã rời cuộc gọi" in the chat timeline.
      const actorPrevStatus = callHistory.members.find(
        (m) => m.id.toString() === actionUser.usr_id.toString(),
      )?.status;

      // ─── Phase 1: flip member status atomically ───────────────
      // Replace-the-whole-array approach (`$set: { members: [...] }`)
      // proved unreliable — Mongoose subdoc spread + array set
      // sometimes returned the doc without the new statuses persisted
      // (likely strict-schema/cast quirk on cloned subdocs).
      //
      // Switch to `arrayFilters` — Mongo updates the matching slot in
      // place. `members.$[].status` for p2p flips ALL slots; the
      // arrayFilter form for sfu flips only the actor's slot.
      // Filter by `user_id` (Mongo ObjectId) instead of `id` (string
      // ULID). The Member schema has `_id: false`, which makes Mongoose
      // synthesise a virtual `id` getter that can shadow the explicit
      // string field in arrayFilter resolution under some Mongoose
      // versions — leading to `actor.id` matching nothing and silent
      // no-op updates. `user_id` is a real ObjectId field with no
      // virtual conflict, so the filter is unambiguous.
      const actorObjectId = actionUser._id;
      let phase1Result: { matchedCount: number; modifiedCount: number };
      if (!isGroupCall) {
        // p2p: end everyone (this and the other peer).
        phase1Result = await this.callHistoryModel.updateOne(
          { _id: callHistory._id },
          { $set: { 'members.$[].status': 'ended' } },
        );
      } else {
        // sfu group: only the actor's slot.
        phase1Result = await this.callHistoryModel.updateOne(
          { _id: callHistory._id },
          { $set: { 'members.$[actor].status': status } },
          { arrayFilters: [{ 'actor.user_id': actorObjectId }] },
        );
      }
      this.log.log(
        `[endCall.phase1] callId=${callHistory.call_id} actor=${String(actorObjectId)} status=${status} isGroup=${isGroupCall} matched=${phase1Result.matchedCount} modified=${phase1Result.modifiedCount}`,
      );

      // Re-fetch with the post-update statuses so the
      // shouldEnd-decision uses the freshest state — racing endCall
      // calls each see the cumulative effect of the others.
      const afterStatusFlip = await this.callHistoryModel
        .findById(callHistory._id)
        .exec();
      if (!afterStatusFlip) {
        throw new BadRequestException('Không tìm thấy lịch sử cuộc gọi');
      }

      const totalTrulyEnded = afterStatusFlip.members.filter(
        (m) => m.status === 'ended',
      ).length;
      const stillActive = afterStatusFlip.members.filter(
        (m) =>
          m.status === 'started' ||
          m.status === 'accepted' ||
          m.status === 'joined',
      ).length;

      const shouldEnd =
        !isGroupCall || (totalTrulyEnded > 0 && stillActive === 0);

      // ─── Phase 2: atomically set ended_at exactly once ─────────
      // Race protection: nhiều endCall (caller cancel + auto-miss +
      // disconnect handler) cùng tới đây. Chỉ writer đầu tiên thấy
      // `ended_at: null` → set Date. Còn lại condition không match
      // → callJustEnded stays false → không emit duplicate log.
      let callJustEnded = false;
      let updatedHistory = afterStatusFlip;
      if (shouldEnd) {
        const winner = await this.callHistoryModel.findOneAndUpdate(
          { _id: callHistory._id, ended_at: null },
          { $set: { ended_at: new Date() } },
          { new: true },
        );
        if (winner) {
          callJustEnded = true;
          updatedHistory = winner;
        }
      }
      callHistory = updatedHistory;

      this.log.log(
        `[endCall] callId=${callHistory.call_id} actor=${actionUser.usr_id} status=${status} shouldEnd=${shouldEnd} callJustEnded=${callJustEnded} ended_at=${callHistory.ended_at?.toISOString() ?? 'null'} actorStatusAfter=${callHistory.members.find((m) => m.id === actionUser.usr_id.toString())?.status ?? 'NOT_FOUND'} stillActive=${stillActive}`,
      );

      // Group call → log appropriately based on what just happened.
      // Skip p2p (1-1) entirely — that conversation IS the call
      // message itself, no separate "left" / "ended" entry needed.
      //
      // Decision matrix (group / sfu):
      //   call.ended  → ended_at vừa set (cuộc gọi đóng hoàn toàn).
      //                 Emit ONCE, kể cả khi nhiều endCall fire cùng
      //                 lúc — `wasAlreadyEnded` chặn duplicate.
      //   call.left   → user vừa "đã rời" cuộc gọi đang diễn ra. CHỈ
      //                 emit cho những user thực sự đã join trước đó
      //                 (status='ended' xác nhận họ join → leave).
      //                 missed / rejected / cancelled là "không bắt
      //                 máy / từ chối / huỷ", KHÔNG hiển thị "đã rời"
      //                 vì họ chưa từng tham gia.
      //   bỏ log     → status missed / rejected / cancelled mà cuộc
      //                 gọi vẫn đang diễn ra: silent. UI không cần
      //                 thông báo từng người không bắt máy.
      if (callHistory.call_mode === 'sfu') {
        // `callJustEnded` được set ở phase atomic update phía trên —
        // chỉ true cho đúng MỘT writer thắng race condition khi
        // chuyển ended_at từ null → Date. Mọi caller khác trong cùng
        // window race đều thấy false → không emit duplicate
        // "Cuộc gọi đã kết thúc" log.
        let eventType: 'call.ended' | 'call.left' | null = null;
        let placeholder = '';
        if (callJustEnded) {
          eventType = 'call.ended';
          placeholder = this.formatCallEndedPlaceholder(callHistory);
        } else if (
          !callHistory.ended_at &&
          status === 'ended' &&
          (actorPrevStatus === 'started' ||
            actorPrevStatus === 'accepted' ||
            actorPrevStatus === 'joined')
        ) {
          // Genuine "đã rời":
          //   - Call still active (no ended_at)
          //   - Actor sent status='ended'
          //   - Actor was ACTUALLY in the call (prev status =
          //     'started' / 'accepted' / 'joined') — this is the
          //     missing check that caused phantom "X đã rời cuộc gọi"
          //     logs for users who only briefly opened a popup, never
          //     accepted into media, then closed the window. Their
          //     prev status was 'pending' / 'invited' so we skip.
          eventType = 'call.left';
          placeholder = `${actionUser.usr_fullname} đã rời cuộc gọi`;
        }

        if (eventType) {
          await this.roomService
            .writeLogRoom({
              event_type: eventType,
              room_id: room._id,
              actor_id: actionUser._id,
              targets: callHistory.members.map((m) => m.user_id),
              placeholder,
              payload: {
                callId: callHistory.call_id,
                callMode: callHistory.call_mode,
                callMessageId: callHistory.message_id?.toString(),
                endStatus: status,
                startedAt: callHistory.started_at,
                endedAt: callHistory.ended_at,
                durationMs:
                  callJustEnded && callHistory.started_at
                    ? new Date(callHistory.ended_at!).getTime() -
                      new Date(callHistory.started_at).getTime()
                    : undefined,
              },
            })
            .catch((err) =>
              this.log.error(
                `[CALL_LOG] Failed to log ${eventType}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
            );
        }
      }

      const msg = await this.hydrateMsgs(
        await this.messageModel.aggregate(
          buildMessageDetailPipeline(callHistory.message_id.toString()),
        ),
      );
      return Response.success(
        {
          history: callHistory,
          room: room,
          msg: this.serializeRoomEvent(msg[0] as Record<string, any>),
        },
        'Cuộc gọi đã được kết thúc',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ endCall ~ error:', error);
      return Response.badRequest('Không kết thúc được cuộc gọi');
    }
  }

  /**
   * Build a friendly "Cuộc gọi đã kết thúc - X phút Y giây" string for the
   * call.ended system event. Falls back to a duration-less message when the
   * call never actually started (cancelled before pickup).
   */
  private formatCallEndedPlaceholder(callHistory: CallHistory): string {
    if (!callHistory.started_at || !callHistory.ended_at) {
      return 'Cuộc gọi đã kết thúc';
    }
    const durationMs =
      new Date(callHistory.ended_at).getTime() -
      new Date(callHistory.started_at).getTime();
    if (durationMs <= 0) return 'Cuộc gọi đã kết thúc';

    const totalSec = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0) parts.push(`${minutes} phút`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} giây`);

    return `Cuộc gọi đã kết thúc · ${parts.join(' ')}`;
  }

  /**
   * Cheap "is this call still alive?" probe used by the socket gateway when
   * deciding whether to reject `already_in_call`. Redis can hold a stale
   * USER_IN_CALL marker if the popup crashed or beforeunload didn't get a
   * chance to fire EndCall — in that case, the marker points at a callId
   * that the DB knows has already ended. We let the gateway clear the
   * stale marker and proceed instead of permanently locking the user out.
   *
   * `ended = true` when EITHER the document has `ended_at` set OR every
   * member is in a terminal state (ended/cancelled/rejected/missed).
   */
  async getCallStatus({ callId }: { callId: string }) {
    try {
      if (!callId) {
        return Response.success(
          { call_id: '', exists: false, ended: true, ended_at: '' },
          'callId rỗng',
        );
      }
      const callHistory = await this.callHistoryModel
        .findOne({ call_id: callId })
        .lean();
      if (!callHistory) {
        return Response.success(
          { call_id: callId, exists: false, ended: true, ended_at: '' },
          'Cuộc gọi không tồn tại',
        );
      }
      const TERMINAL = new Set<MemberStatus>([
        'ended',
        'cancelled',
        'rejected',
        'missed',
      ]);
      const allMembersTerminal =
        Array.isArray(callHistory.members) &&
        callHistory.members.length > 0 &&
        callHistory.members.every((m) => TERMINAL.has(m.status));
      const ended = !!callHistory.ended_at || allMembersTerminal;
      return Response.success(
        {
          call_id: callId,
          exists: true,
          ended,
          ended_at: callHistory.ended_at
            ? new Date(callHistory.ended_at).toISOString()
            : '',
        },
        'OK',
      );
    } catch (error) {
      console.log('🚀 ~ HandleChatService ~ getCallStatus ~ error:', error);
      // On any error, treat as "still active" so we don't accidentally clear
      // a valid in-call marker. The gateway will fall back to the existing
      // reject behavior.
      return Response.success(
        { call_id: callId, exists: true, ended: false, ended_at: '' },
        'Không kiểm tra được trạng thái cuộc gọi',
      );
    }
  }

  /**
   * Cross-service: get messages for a room by its room_id (business key).
   * Returns basic message data suitable for cross-service hydration.
   * No userId-dependent filtering (no membership check, no clear_before_ts
   * hiding, no user-specific sender hydration).
   */
  async getMessagesByRoomId(
    roomId: string,
    limit: number,
    offset: number,
  ) {
    // Resolve the room's MongoDB _id from the business key
    const room = await this.roomModel
      .findOne(
        {
          $or: [
            { room_id: roomId },
            ...(Types.ObjectId.isValid(roomId)
              ? [{ _id: new Types.ObjectId(roomId) }]
              : []),
          ],
        },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }>();
    if (!room) {
      throw new NotFoundException('không tìm thấy phòng');
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const messages = await this.messageModel.aggregate([
      { $match: { msg_roomId: room._id } },
      { $sort: { createdAt: -1 } },
      { $skip: safeOffset },
      { $limit: safeLimit },
      { $sort: { createdAt: 1 } },
      {
        $project: {
          id: { $toString: '$_id' },
          roomId: { $toString: '$msg_roomId' },
          type: '$msg_type',
          content: { $ifNull: ['$msg_content', ''] },
          createdAt: { $toString: '$createdAt' },
          editedAt: {
            $ifNull: [{ $toString: '$editedAt' }, ''],
          },
          deletedAt: {
            $ifNull: [{ $toString: '$deletedAt' }, ''],
          },
          isDeleted: { $toBool: '$deletedAt' },
          pinned: { $ifNull: ['$pinned', false] },
          placeholder: { $ifNull: ['$placeholder', ''] },
          documentId: { $ifNull: [{ $toString: '$document_id' }, ''] },
          hiddenBy: { $literal: [] },
          read_by: { $literal: [] },
          read_by_count: { $literal: 0 },
          sender: { $literal: null },
          attachments: {
            $map: {
              input: { $ifNull: ['$attachment_ids', []] },
              as: 'att',
              in: {
                _id: { $toString: '$$att' },
              },
            },
          },
          reactions: { $literal: [] },
          reply: { $literal: null },
          call_history: { $literal: null },
          quiz: {
            $cond: [
              { $ifNull: ['$quiz_id', false] },
              { id: { $toString: '$quiz_id' } },
              null,
            ],
          },
          flashcard: { $literal: null },
          todoProject: { $literal: null },
          room_event: { $literal: null },
        },
      },
    ]);

    return messages;
  }

  async addAttachmentToMessage(messageId: string, attachmentId: string) {
    if (!Types.ObjectId.isValid(messageId) || !Types.ObjectId.isValid(attachmentId)) {
      throw new BadRequestException('messageId hoặc attachmentId không hợp lệ');
    }

    const updated = await this.messageModel.findByIdAndUpdate(
      messageId,
      {
        $addToSet: {
          attachment_ids: new Types.ObjectId(attachmentId),
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Không tìm thấy tin nhắn');
    }

    return Response.success(
      { messageId, attachmentId },
      'Đã gắn attachment vào tin nhắn',
    );
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
