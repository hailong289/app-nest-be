import { REDISKEY } from '@app/constants/RedisKey';
import { CreateMessage } from '@app/dto';
import Utils from '@app/helpers/utils';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Room,
  User,
  Message,
  RoomsState,
  MessageRead,
  RoomsUsersState,
} from 'libs/db/src';
import { FilterQuery, Model } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { Response } from '@app/helpers/response';
import { buildMessageCorePipeline } from './Pipeline/getMsg';

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
  ) {}

  async createMessage(payload: CreateMessage) {
    const { roomId, userId, type, content, attachments, replyTo, pinned } =
      payload;
    this.log.log('🚀 ~ HandleChatService ~ createMessage ~ payload:', payload);

    const check = await this.roomService.checkExistedMemberRoom(userId, roomId);
    if (!check) {
      throw new NotFoundException('Bạn không thuộc thể gửi tin nhắn');
    }
    // get info room
    const finInfo = await this.roomModel.findOne({
      $or: [
        { room_id: roomId },
        { room_id: this.utils.pairRoomId(roomId, userId) },
      ],
    });
    if (!finInfo) {
      throw new NotFoundException('Phòng không tồn tại');
    }

    try {
      // create new message (without transaction for standalone MongoDB)
      const createNewMsg = await this.messageModel.create({
        msg_roomId: finInfo._id,
        msg_sender: this.utils.convertToObjectIdMongoose(userId),
        msg_content: content,
        reply_to: replyTo,
        attachments: attachments,
        msg_type: type,
        pinned: pinned,
      });

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

      // Get message details
      const result = await this.getOneMsg(userId, createNewMsg._id.toString());

      return {
        msg: result,
        members: finInfo.room_members,
      };
    } catch (error) {
      this.log.error('Error creating message:', error);
      throw error;
    }
  }
  private async recomputeUnreadForUserRoom(
    userId: string,
    roomMongoId: string,
  ) {
    const uid = this.utils.convertToObjectIdMongoose(userId);
    const rid = this.utils.convertToObjectIdMongoose(roomMongoId);

    // Lấy room để có room.room_id (business id) map qua Messages.msg_roomId
    const room = await this.roomModel
      .findById(rid)
      .select({ _id: 1, room_id: 1 })
      .lean();
    if (!room?.room_id) throw new Error('Room not found or missing room_id');

    const state = await this.RoomsUsersState.findOne({
      room_id: rid,
      user_id: uid,
    }).lean();
    const lastAt = state?.last_read_at ?? null;
    const clearTs = state?.clear_before_ts ?? null;

    // mốc bắt đầu đếm: max(last_read_at, clear_before_ts)
    const baseTs =
      lastAt && clearTs
        ? lastAt > clearTs
          ? lastAt
          : clearTs
        : lastAt || clearTs || null;

    const filter: FilterQuery<Message> = {
      msg_roomId: room.room_id,
      msg_sender: { $ne: uid },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };
    if (baseTs) filter.createdAt = { $gt: baseTs };

    const unread = await this.messageModel.countDocuments(filter);

    const updated = await this.RoomsUsersState.findOneAndUpdate(
      { room_id: rid, user_id: uid },
      { $set: { unread_count: unread } },
      { new: true, upsert: true },
    );

    return { unread_count: updated.unread_count };
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
}
