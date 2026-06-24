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
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Room,
  Message,
  MessageDocument,
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
  Document,
  Quiz,
} from 'libs/db/src';
import { Model, Types } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { RoomCacheRepository } from '../rooms/room-cache.repository';
import {
  buildMessageCorePipeline,
  buildMessageDetailPipeline,
  buildMessagesDetailPipeline,
} from './Pipeline/getMsg';
import { Response } from '@app/helpers/response';
import { MemberStatus } from 'libs/db/src/mongo/model/call-history.model';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { REDISKEY } from '@app/constants/RedisKey';
import {
  ChangeEventType,
  KafkaEvent,
  notifyType,
  socketEvent,
} from '@app/dto/enum.type';
import { ChangeFeedService } from '../change-feed/change-feed.service';
import { RemoteSocketEmitter } from 'libs/ws/src';
import { RedisService } from 'libs/db/src/redis/redis.service';
import { RoomType } from 'libs/db/src/mongo/model/room.model';
import { TodoProject } from 'libs/db/src/mongo/model/todo-project.model';

/**
 * Shape of a Room served from RoomCacheRepository: a plain (lean) object that
 * always carries `_id` at runtime even though the Room class doesn't declare
 * it. The read-only call sites only touch `_id`, `room_members`, `room_type`
 * and `room_id`, so this lean view is sufficient.
 */
type CachedRoom = Room & { _id: Types.ObjectId };

@Injectable()
export class HandleChatService {
  private readonly utils = Utils;
  private readonly key = REDISKEY;

  private readonly log = new Logger();
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(MessageRead.name)
    private readonly messageReadModel: Model<MessageRead>,
    @InjectModel(RoomsState.name)
    private readonly RoomsStateModel: Model<RoomsState>,
    private readonly roomService: RoomsService,
    private readonly roomCache: RoomCacheRepository,
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
    @InjectModel(Document.name)
    private readonly documentModel: Model<Document>,
    @Inject(SERVICES.AI)
    private readonly aiClient: ClientKafka,
    @Inject(SERVICES.FILESYSTEM)
    private readonly fileClient: ClientKafka,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @InjectModel(Quiz.name)
    private readonly quizModel: Model<Quiz>,
    @InjectModel(TodoProject.name)
    private readonly todoProjectModel: Model<TodoProject>,
    private readonly emitter: RemoteSocketEmitter,
    @Inject(SERVICES.CHAT)
    private readonly chatClient: ClientKafka,
    private readonly redis: RedisService,
    private readonly changeFeed: ChangeFeedService,
  ) {}

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

  /**
   * Re-fetch một message (pipeline đã join summary mới từ aiembeddings) rồi
   * broadcast MSGUPSERT để FE cập nhật bong bóng realtime sau khi AI tóm tắt
   * xong file đính kèm. Bắn thẳng qua Redis adapter tới room channel — clients
   * join roomId lúc connect/mở phòng (xem rooms.service `room:update`).
   * No-op khi message không tồn tại. Không ném lỗi (side-effect phụ).
   */
  async broadcastFileSummary(messageId: string): Promise<void> {
    if (!messageId) return;
    const msg = await this.messageModel.aggregate(
      buildMessageDetailPipeline(messageId),
    );
    const doc = msg?.[0] as Record<string, any> | undefined;
    if (!doc) return;
    const roomId = doc.roomId ? String(doc.roomId) : '';
    if (!roomId) return;
    this.emitter.broadcastTo(
      '/chat',
      roomId,
      socketEvent.MSGUPSERT,
      this.serializeRoomEvent(doc),
    );
  }

  /**
   * Catch-up `message.updated` (fat) cho TOÀN member của phòng + gắn `seq` vào
   * `msg` để live (gateway broadcast) dùng CHUNG seq với catch-up. Dùng cho
   * react / pin / recall — các thay đổi message hiển thị cho mọi người.
   * No-op khi không có msg/recipient. KHÔNG ném lỗi (outbox là phụ).
   */
  private async emitMsgUpdated(
    finInfo: CachedRoom,
    msg: Record<string, any> | undefined,
  ): Promise<void> {
    if (!msg) return;
    const recipients = finInfo.room_members.map((m) => m.user_id.toString());
    if (!recipients.length) return;
    let seq = 0;
    try {
      seq = await this.changeFeed.nextSeq();
    } catch {
      seq = 0;
    }
    if (seq) msg.seq = seq;
    await this.changeFeed.emitWithSeq(seq, {
      type: ChangeEventType.MESSAGE_UPDATED,
      roomId: finInfo._id.toString(),
      recipients,
      payload: {
        roomId: finInfo.room_id,
        roomMongoId: finInfo._id.toString(),
        msg,
      },
    });
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
      desk_id,
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
    const finInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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
      desk_id: desk_id ? this.utils.convertToObjectIdMongoose(desk_id) : null,
      todo_project_id: null as Types.ObjectId | null,
    };

    if (todoProjectId) {
      const todoProject = await this.todoProjectModel.findOne({
        project_id: todoProjectId,
      });
      if (!todoProject) {
        throw new NotFoundException('Dự án không tồn tại');
      }
      updatePayload.todo_project_id = todoProject._id;
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

    // Phát realtime NGAY khi payload đã đầy đủ — KHÔNG chờ tail side-effect
    // (Kafka embedding, push notification, bulkWrite unread) ở dưới, và KHÔNG
    // đi vòng gRPC response → gateway → emit. Bắn thẳng qua Redis adapter:
    // chat service → Redis → apps/socket → client. Nhắm tới room cá nhân của
    // từng thành viên (ROOM_CLIENT) — đúng semantics gateway đang dùng, room
    // này luôn được join lúc connect nên không phụ thuộc trạng thái join roomId.
    //
    // HOT PATH: tin TEXT thuần (không attachment/reply/quiz/desk/todo/doc) —
    // chiếm phần lớn lưu lượng burst — KHÔNG cần aggregate ~13 \$lookup. Dựng
    // payload realtime ngay trong code, GIỮ NGUYÊN shape mà
    // buildMessageDetailPipeline trả về (FE upsetMsg không phải đổi). Các loại
    // tin còn lại vẫn đi aggregate đã kiểm chứng.
    const isPlainText =
      createNewMsg.msg_type === 'text' &&
      (createNewMsg.attachment_ids?.length ?? 0) === 0 &&
      !createNewMsg.reply_to &&
      !createNewMsg.quiz_id &&
      !createNewMsg.desk_id &&
      !createNewMsg.todo_project_id &&
      !createNewMsg.document_id;

    const serializedMsg = isPlainText
      ? this.buildRealtimeTextPayload(createNewMsg, userInfo)
      : this.serializeRoomEvent(
          (
            await this.messageModel.aggregate(
              buildMessageDetailPipeline(createNewMsg._id.toString()),
            )
          )[0] as Record<string, any>,
        );
    // Cấp `seq` change-feed SỚM để gắn vào payload realtime (MSGUPSERT). Cùng
    // `seq` này được truyền sang tail `handleMessagePersisted` để ghi outbox
    // `room.newmsgs` → live + catch-up dùng CHUNG một seq, client tiến con trỏ
    // nhất quán. Lỗi cấp seq không được chặn create path.
    let changeSeq = 0;
    try {
      changeSeq = await this.changeFeed.nextSeq();
    } catch {
      changeSeq = 0;
    }
    if (changeSeq) serializedMsg.seq = changeSeq;
    const memberClientRooms = finInfo.room_members.map((m) =>
      this.key.ROOM_CLIENT(m.id),
    );
    this.emitter.broadcastTo(
      '/chat',
      memberClientRooms,
      socketEvent.MSGUPSERT,
      serializedMsg,
    );

    // Toàn bộ "tail" (cập nhật RoomsState/MessageRead/RoomsUsersState + unread +
    // emit downstream embedding/link/share/push) được ĐẨY SANG consumer
    // MESSAGE_PERSISTED của chính chat service. Create path chỉ emit MỘT event
    // rồi trả về — không chặn bởi N-write Mongo, không bị bão write làm nghẽn DB.
    // Consumer group đóng vai trò điều tiết để Mongo nhận tải đều.
    const otherMemberIds = finInfo.room_members
      .filter((i) => i.user_id.toString() !== userInfo._id.toString())
      .map((i) => i.user_id.toString());

    // KHÔNG await: realtime đã broadcast ở trên, ack không nên chờ Kafka tail.
    // Tail (RoomsState/unread/last_message) do consumer MESSAGE_PERSISTED xử lý
    // bất đồng bộ; await ở đây chỉ kéo độ trễ broker vào ack. Fire-and-forget.
    void this.utils.dispatchEventKafka(
      this.chatClient,
      KafkaEvent.MESSAGE_PERSISTED,
      {
        messageId: createNewMsg._id.toString(),
        createdAt:
          createNewMsg.createdAt instanceof Date
            ? createNewMsg.createdAt.toISOString()
            : null,
        roomMongoId: finInfo._id.toString(),
        roomCustomId: finInfo.room_id,
        senderId: userId,
        type,
        content: content || '',
        documentId: documentId || null,
        room_type: finInfo.room_type,
        room_name: finInfo.room_name,
        sender_fullname: userInfo.usr_fullname,
        otherMemberIds,
        serializedMsg,
        changeSeq,
      },
      // key=roomMongoId → mọi tin cùng room về cùng partition: consumer tail
      // (RoomsState/unread/last_message) xử lý ĐÚNG THỨ TỰ trong room dù
      // MESSAGE_PERSISTED đã tăng lên nhiều partition.
      finInfo._id.toString(),
    ).catch((err) => {
      // dispatchEventKafka tự nuốt lỗi (trả Response.error, không throw);
      // .catch chỉ phòng hờ tránh unhandled rejection.
      this.log.warn(
        `[MESSAGE_PERSISTED] dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return Response.success(
      {
        msgId: createNewMsg._id.toString(),
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: serializedMsg,
      },
      'Tin nhắn mới thành công',
    );
  }

  /**
   * Dựng payload realtime cho tin TEXT thuần, KHỚP TỪNG FIELD với output của
   * buildMessageDetailPipeline (đường aggregate) để FE không phải đổi. Chỉ gọi
   * khi tin chắc chắn không có attachment/reply/quiz/desk/todo/doc — nên mọi
   * field phụ đều là rỗng/null như pipeline trả về cho tin mới:
   *   reactions/read_by/hiddenBy/attachments = [], read_by_count = 0,
   *   reply/call_history/quiz/desk/todoProject/room_event/summary = null.
   * editedAt/deletedAt/placeholder để nguyên (undefined → bị bỏ khi JSON hoá,
   * giống pipeline bỏ field không tồn tại).
   */
  private buildRealtimeTextPayload(
    msg: MessageDocument,
    sender: User & { _id: Types.ObjectId },
  ): Record<string, any> {
    return {
      _id: msg._id,
      roomId: msg.msg_roomId,
      id: msg._id,
      type: msg.msg_type,
      content: msg.msg_content,
      createdAt: msg.createdAt,
      editedAt: msg.editedAt,
      deletedAt: msg.deletedAt,
      isDeleted: !!msg.deletedAt,
      pinned: msg.pinned,
      placeholder: msg.placeholder,
      sender: {
        _id: sender._id,
        fullname: sender.usr_fullname,
        avatar: sender.usr_avatar,
        id: sender.usr_id,
      },
      attachments: [],
      reactions: [],
      reply: null,
      hiddenBy: [],
      documentId: null,
      read_by: [],
      read_by_count: 0,
      call_history: null,
      quiz: null,
      desk: null,
      todoProject: null,
      room_event: null,
      summary: null,
    };
  }

  /** Preview text của tin nhắn cho last_message / push theo loại. */
  private buildContentSnap(type: string, content?: string): string {
    switch (type) {
      case 'image':
        return '[Hình ảnh]';
      case 'file':
        return '[File đính kèm]';
      case 'document':
        return '[Tài liệu]';
      case 'video':
        return '[Video]';
      case 'audio':
        return '[Tin nhắn thoại]';
      case 'gif':
        return 'Đã gửi file gif';
      case 'quiz':
        return '[Bài kiểm tra]';
      default:
        return content || '[Tin nhắn]';
    }
  }

  /**
   * "Tail" bất đồng bộ của createMessage — chạy trong Kafka consumer của chat
   * (KafkaEvent.MESSAGE_PERSISTED). KHÔNG chặn create path; điều tiết tải ghi
   * Mongo qua consumer group. Idempotent nhờ khoá MSG_PROCESSED (Kafka có thể
   * redeliver, mà HINCRBY thì không idempotent).
   */
  async handleMessagePersisted(payload: {
    messageId: string;
    createdAt: string | null;
    roomMongoId: string;
    roomCustomId: string;
    senderId: string;
    type: string;
    content: string;
    documentId?: string | null;
    room_type: string;
    room_name: string;
    sender_fullname: string;
    otherMemberIds: string[];
    serializedMsg: Record<string, any>;
    /** seq change-feed cấp ở createMessage, dùng chung cho live + catch-up. */
    changeSeq?: number;
  }) {
    const {
      messageId,
      createdAt,
      roomMongoId,
      roomCustomId,
      senderId,
      type,
      content,
      documentId,
      room_type,
      room_name,
      sender_fullname,
      otherMemberIds,
      serializedMsg,
      changeSeq,
    } = payload;

    // Dedupe: mỗi message chỉ chạy tail 1 lần.
    const processedKey = this.key.MSG_PROCESSED(messageId);
    if (await this.redis.getData<string>(processedKey)) return;
    await this.redis.setData(processedKey, '1', 24 * 60 * 60);

    const roomObjId = this.utils.convertToObjectIdMongoose(roomMongoId);
    const senderObjId = this.utils.convertToObjectIdMongoose(senderId);
    const msgObjId = this.utils.convertToObjectIdMongoose(messageId);
    const readAt = createdAt ? new Date(createdAt) : new Date();
    const contentSnap = this.buildContentSnap(type, content);

    // 1) Unread hot-path trên Redis (atomic) cho member khác + đánh dấu dirty.
    //    Field = roomMongoId (= RoomsUsersState.room_id) để flush khỏi phải map.
    if (otherMemberIds.length > 0) {
      await this.redis.pipelineHIncrBy(
        otherMemberIds.map((uid) => ({
          key: this.key.UNREAD(uid),
          field: roomMongoId,
          by: 1,
        })),
        {
          key: this.key.UNREAD_DIRTY(),
          members: otherMemberIds.map((uid) => `${uid}:${roomMongoId}`),
        },
      );
    }

    // recipient không mute để push
    const recipientsForPush = await this.RoomsUsersState.find({
      room_id: roomObjId,
      user_id: {
        $in: otherMemberIds.map((i) => this.utils.convertToObjectIdMongoose(i)),
      },
      muted: false,
    }).select('user_id');

    // 2) Cập nhật Mongo + emit downstream song song (không cần trả kết quả).
    await Promise.allSettled([
      this.RoomsStateModel.findOneAndUpdate(
        { room_id: roomObjId },
        {
          last_message_id: msgObjId,
          'last_message_snapshot.content': contentSnap,
          'last_message_snapshot.sender_id': senderObjId,
        },
        { upsert: true },
      ),
      this.messageReadModel.findOneAndUpdate(
        { room_id: roomObjId, user_id: senderObjId },
        { msg_id: msgObjId, uniq: `${messageId}:${senderId}`, readAt },
        { upsert: true },
      ),
      this.RoomsUsersState.findOneAndUpdate(
        { room_id: roomObjId, user_id: senderObjId },
        { last_read_msg_id: msgObjId, last_read_at: readAt, unread_count: 0 },
        { upsert: true },
      ),
      // sender đọc tin của mình → clear unread Redis của sender cho phòng này
      this.redis.hSet(this.key.UNREAD(senderId), roomMongoId, '0'),
      ...(type === 'text'
        ? [
            this.utils.dispatchEventKafka(
              this.aiClient,
              KafkaEvent.AI_CHAT_MSG_EMBEDDING,
              { text: content, roomId: roomObjId, messageId: msgObjId },
            ),
          ]
        : []),
      ...(content && /(https?:\/\/[^\s]+)/g.test(content)
        ? [
            this.utils.dispatchEventKafka(
              this.fileClient,
              KafkaEvent.PROCESS_LINK,
              { content, userId: senderId, roomId: roomMongoId, messageId },
            ),
          ]
        : []),
      ...(documentId
        ? [
            this.utils.dispatchEventKafka(
              this.fileClient,
              KafkaEvent.SHARE_DOC_FOR_ROOM,
              {
                roomId: roomCustomId,
                userId: senderId,
                docId: documentId,
                messageId,
              },
            ),
          ]
        : []),
      this.utils.dispatchEventKafka(
        this.notificationClient,
        KafkaEvent.PUSH_NOTIFICATION_USERS,
        {
          userIds: recipientsForPush.map((i) => i.user_id),
          title:
            room_type === RoomType.Private
              ? sender_fullname
              : `${room_name} : ${sender_fullname}`,
          message: contentSnap,
          data: {
            type: notifyType.noify_new_message,
            push_type: 'message',
            msg: serializedMsg,
          },
        },
      ),
    ]);

    // ── Change-feed catch-up (login/mở lại bù phần miss) ──────────────
    // `room.newmsgs`: 1 high-water-mark/người-nhận (compaction), dùng CHUNG
    // `changeSeq` với MSGUPSERT live nên client online đã thấy thì lần reopen
    // chỉ no-op. `room.read` cho sender → multi-device biết sender đã đọc tới.
    if (changeSeq && otherMemberIds.length > 0) {
      await this.changeFeed.emitWithSeq(changeSeq, {
        type: ChangeEventType.ROOM_NEWMSGS,
        roomId: roomMongoId,
        recipients: otherMemberIds,
        payload: {
          roomId: roomCustomId,
          roomMongoId,
          newestMsgId: messageId,
          newestMsgTs: createdAt,
        },
      });
    }
    await this.changeFeed.emit({
      type: ChangeEventType.ROOM_READ,
      roomId: roomMongoId,
      recipients: [senderId],
      payload: {
        roomId: roomCustomId,
        roomMongoId,
        lastReadMsgId: messageId,
        lastReadAt: createdAt,
        unreadCount: 0,
      },
    });
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
    const msg = result[0] as Record<string, any>;
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
      this.roomCache.getByPairOrRoomId(
        roomId,
        this.utils.pairRoomId(userInfo.usr_id, roomId),
      ) as Promise<CachedRoom | null>,
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
          // Reader has caught up to "now" → unread resets to 0. Previously
          // this fanned out an exact recompute for EVERY room member (N heavy
          // aggregates per read), but one user reading never changes another
          // user's unread — pure waste. New messages re-increment via
          // createMessage's $inc.
          unread_count: 0,
        },
      ),
      // Reset unread hot-path trên Redis + đánh dấu dirty để flush ghi 0 về Mongo.
      // Field = Room._id (khớp RoomsUsersState.room_id) để flush khỏi map.
      this.redis.hSet(this.key.UNREAD(userId), roomInfro._id.toString(), '0'),
      this.redis.sAdd(
        this.key.UNREAD_DIRTY(),
        `${userId}:${roomInfro._id.toString()}`,
      ),
    ]);
    const msg = await this.messageModel.aggregate(
      buildMessageDetailPipeline(messgeInfo._id.toString()),
    );
    const serializedMsg = this.serializeRoomEvent(
      msg[0] as Record<string, any>,
    );
    // Change-feed: read-pointer của user đổi → catch-up `room.read`. Dùng chung
    // seq với event mark:read live (gắn vào msg trả về cho gateway broadcast).
    const readSeq = await this.changeFeed.emit({
      type: ChangeEventType.ROOM_READ,
      roomId: roomInfro._id.toString(),
      recipients: [userInfo._id.toString()],
      payload: {
        roomId: roomInfro.room_id,
        roomMongoId: roomInfro._id.toString(),
        lastReadMsgId: messgeInfo._id.toString(),
        lastReadAt: readAt,
        unreadCount: 0,
      },
    });
    if (readSeq && serializedMsg) serializedMsg.seq = readSeq;
    return Response.success(
      {
        msgId: messgeInfo._id.toString(),
        members: roomInfro.room_members,
        roomId: roomInfro.room_id,
        msg: serializedMsg,
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
    const roomInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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
    // Stringify each message's room_event.payload so it survives gRPC.
    const serialized = (result as Record<string, any>[]).map((m) =>
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
    const finInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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
    const msg = await this.messageModel.aggregate(
      buildMessageDetailPipeline(msgId),
    );
    const serializedMsg = this.serializeRoomEvent(
      msg[0] as Record<string, any>,
    );
    await this.emitMsgUpdated(finInfo, serializedMsg);
    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: serializedMsg,
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
    const finInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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
    // The pin write mutated the room row (room_ghim). Drop the cached copy so
    // the next read reflects the updated pinned-messages list.
    await this.roomCache.invalidate(finInfo);
    const msg = await this.messageModel.aggregate(
      buildMessageDetailPipeline(msgId),
    );
    // Notify clients to refresh room info (pinned messages updated).
    // Lightweight ping — pin events already surface via MSGPINNED, this just
    // nudges the room metadata.
    this.roomService.notifyRoomChanged(finInfo.room_id.toString(), {
      reason: 'pinned-changed',
      messageId: msgId,
      pinned,
    });

    const serializedMsg = this.serializeRoomEvent(
      msg[0] as Record<string, any>,
    );
    await this.emitMsgUpdated(finInfo, serializedMsg);
    return Response.success(
      {
        msgId,
        members: finInfo.room_members,
        roomId: finInfo.room_id,
        msg: serializedMsg,
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
    const finInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    // Hiding a message can change THIS user's unread (a hidden unread message
    // no longer counts). Recompute exactly for the hiding user only — hide is
    // a rare action, and it reconciles the $inc-based counter which does not
    // subtract hidden messages.
    await this.recomputeUnreadForUserRoom(userId, finInfo._id.toString());
    // update many
    const findMsg = await this.messageModel
      .find({
        reply_to: this.utils.convertToObjectIdMongoose(msgId),
      })
      .select('_id');
    const msgIds = findMsg.map((i) => i._id.toHexString());
    msgIds.push(msgId);
    const msgs = await this.messageModel.aggregate(
      buildMessagesDetailPipeline(msgIds),
    );
    // Change-feed: ẩn-cho-tôi là per-user → `message.hidden` chỉ gửi user này.
    const hideSeq = await this.changeFeed.emit({
      type: ChangeEventType.MESSAGE_HIDDEN,
      roomId: finInfo._id.toString(),
      recipients: [userInfo._id.toString()],
      payload: {
        roomId: finInfo.room_id,
        roomMongoId: finInfo._id.toString(),
        msgId,
      },
    });
    if (hideSeq && Array.isArray(msgs) && msgs[0])
      (msgs[0] as Record<string, any>).seq = hideSeq;
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
    const finInfo = (await this.roomCache.getByPairOrRoomId(
      roomId,
      this.utils.pairRoomId(userInfo.usr_id, roomId),
    )) as CachedRoom | null;
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

    const msgs = await this.messageModel.aggregate(
      buildMessagesDetailPipeline(msgIds),
    );
    // Change-feed: thu hồi (toàn phòng) → `message.updated` cho từng msg ảnh
    // hưởng (msg chính + các reply có preview đổi), gửi toàn member.
    for (const m of msgs as Record<string, any>[]) {
      await this.emitMsgUpdated(finInfo, m);
    }
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

      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });
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

      // Change-feed catch-up: tin nhắn `type:'call'` được tạo NGOÀI createMessage
      // (không qua handleMessagePersisted) → tự emit `room.newmsgs` để user offline
      // lúc có cuộc gọi vẫn thấy khi mở lại. Recipients = toàn member phòng.
      const callRecipients = (room.room_members ?? []).map((m) =>
        m.user_id.toString(),
      );
      await this.changeFeed.emit({
        type: ChangeEventType.ROOM_NEWMSGS,
        roomId: room._id.toString(),
        recipients: callRecipients,
        payload: {
          roomId: room.room_id,
          roomMongoId: room._id.toString(),
          newestMsgId: msg._id.toString(),
          newestMsgTs:
            msg.createdAt instanceof Date ? msg.createdAt.toISOString() : null,
        },
      });

      const members = await this.userModel.find({
        usr_id: {
          $in: membersIds.map((m) => m.toString()),
        },
      });

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

      const message = await this.messageModel.aggregate(
        buildMessageDetailPipeline(msg._id.toString()),
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
      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });

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

      const msg = await this.messageModel.aggregate(
        buildMessageDetailPipeline(refreshedHistory.message_id.toString()),
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
      const actionUser = await this.userModel.findOne({ usr_id: actionUserId });
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

      const msg = await this.messageModel.aggregate(
        buildMessageDetailPipeline(callHistory.message_id.toString()),
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
