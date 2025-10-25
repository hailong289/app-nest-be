import { SendFriendRequestDto } from '@app/dto';
import Utils from '@app/helpers/utils';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import friendshipModel, {
  Friendship,
} from 'libs/db/src/mongo/model/friendship.model';
import keysModel, { Key } from 'libs/db/src/mongo/model/keys.model';
import userModel, { User } from 'libs/db/src/mongo/model/user.model';
import { Response } from 'libs/helpers/response';
import { Model, Types } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRoomDto } from '@app/dto/room.dto';
import { getFriendsAggregate } from './aggregates/getFriends';
import roomModel, { Room } from 'libs/db/src/mongo/model/room.model';

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(userModel.name) private readonly userModel: Model<User>,
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    @InjectModel(keysModel.name) private readonly keyModel: Model<Key>,
    @InjectModel(roomModel.name) private readonly roomModel: Model<Room>,
    private readonly roomService: RoomsService,
  ) {}

  // Friend requests
  async sendFriendRequest(data: SendFriendRequestDto) {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(data.frpUserId1),
    });

    if (!user) {
      return Response.error('Người dùng không tồn tại', 400);
    }

    const receiver = await this.userModel.findOne({ usr_id: data.frpUserId2 }); // id tự động tạo bởi system
    if (!receiver) {
      return Response.error('Người nhận không tồn tại', 400);
    }

    const existingFriendship = await this.friendshipModel.findOne({
      frp_userId1: user.usr_id,
      frp_userId2: receiver.usr_id,
      frp_status: 'PENDING',
    });

    if (existingFriendship) {
      return Response.error('Bạn đã gửi lời mời kết bạn cho người này', 400);
    }

    const friendship = await this.friendshipModel.create({
      frp_userId1: user.usr_id,
      frp_userId2: receiver.usr_id,
      frp_actionUserId: user.usr_id,
      frp_status: 'PENDING',
    });
    // gửi notification cho người nhận
    const fcmTokens = await this.keyModel.find(
      { tkn_userId: receiver.usr_id },
      { tkn_fcmToken: 1 },
    );
    if (fcmTokens.length > 0) {
      await axios.post(
        `${process.env.GATEWAY_URL}/api/notifications/push-notification`,
        {
          fcmTokens: fcmTokens.map((token) => token.tkn_fcmToken),
          title: `${user.usr_fullname} đã gửi lời mời kết bạn`,
          message: 'Bạn có một lời mời kết bạn mới',
          data: {
            userId: receiver.usr_id,
            senderId: user.usr_id,
            senderName: user.usr_fullname,
            senderAvatar: user.usr_avatar,
            push_type: 'friend_request',
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }
    return Response.success(friendship, 'Gửi lời mời kết bạn thành công');
  }

  async getFriendRequests(
    userId: string,
    page: number,
    limit: number,
    type: string,
  ) {
    const friendRequests = await this.friendshipModel
      .find({
        [type === 'received' ? 'frp_userId2' : 'frp_userId1']: userId,
        frp_status: 'PENDING',
      })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    const total = await this.friendshipModel.countDocuments({
      [type === 'received' ? 'frp_userId2' : 'frp_userId1']: userId,
      frp_status: 'PENDING',
    });

    const data = friendRequests.map((request) =>
      Utils.unprefix(request.toObject(), 'frp_'),
    );

    return Response.success(
      {
        friendRequests: data,
        total: total,
        page: page,
        limit: limit,
      },
      'Lấy danh sách lời mời kết bạn thành công',
    );
  }

  async acceptFriendRequest(
    frpId: string,
    frpUserId1: string,
    frpUserId2: string,
    frpActionUserId: string,
  ) {
    const user1 = await this.userModel.findOne({ usr_id: frpUserId1 });
    const user2 = await this.userModel.findOne({ usr_id: frpUserId2 });
    if (!user1) {
      return Response.error('Người dùng gửi không tồn tại', 400);
    }
    if (!user2) {
      return Response.error('Người dùng nhận không tồn tại', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: frpId,
      frp_userId1: frpUserId1,
      frp_userId2: frpUserId2,
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Lời mời kết bạn không tồn tại', 400);
    }
    await friendship.updateOne({
      frp_status: 'ACCEPTED',
      frp_actionUserId: frpActionUserId,
    });
    // gửi notification cho người gửi
    const fcmTokens = await this.keyModel.find(
      { tkn_userId: user1._id },
      { tkn_fcmToken: 1 },
    );
    if (fcmTokens.length > 0) {
      const response = await Utils.callApiGateway(
        '/api/notifications/push-notification',
        'POST',
        {
          fcmTokens: fcmTokens.map((token) => token.tkn_fcmToken),
          title: `${user2.usr_fullname} đã chấp nhận lời mời kết bạn`,
          message: 'Bạn đã được kết bạn với người dùng',
          data: {
            userId: user1._id,
            senderId: user2._id,
            senderName: user2.usr_fullname,
            senderAvatar: user2.usr_avatar,
            push_type: 'friend_request',
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
        5000, // 5s thời gian chờ
      );
      if (response.statusCode !== 200) {
        console.error('🔥 Error sending notification:', response);
      }
    }
    const result = {
      frpId,
      frpStatus: 'ACCEPTED',
      friendshipId: 'friend_' + Date.now(),
      acceptedAt: new Date(),
      room: null,
    };
    // tạo phòng chat
    const payload = {
      userId: user1._id.toString(),
      name: `Phòng chat ${Utils.pairRoomId(user1.usr_id, user2.usr_id)}`,
      avatar: '', // Add missing avatar property
      type: 'private',
      memberIds: [user2.usr_id],
    } as CreateRoomDto;
    try {
      const room = await this.roomService.create(payload);
      if (room.statusCode !== 200) {
        await friendship.updateOne({
          frp_status: 'PENDING',
          frp_actionUserId: frpActionUserId,
        });
        return Response.error(
          room.message,
          room.statusCode,
          room.reasonStatusCode,
          'ERROR_CREATE_ROOM',
        );
      }
      result.room = room.metadata;
    } catch (error) {
      console.error('🔥 Error creating room:', error);
      // rollback lời mời kết bạn
      await friendship.updateOne({
        frp_status: 'PENDING',
        frp_actionUserId: frpActionUserId,
      });
      return Response.error(
        'Có lỗi xảy ra khi kết bạn',
        400,
        'ERROR_CREATE_ROOM',
      );
    }
    return Response.success(result, 'Chấp nhận lời mời kết bạn thành công');
  }

  async rejectFriendRequest(
    frpId: string,
    frpUserId1: string,
    frpUserId2: string,
    frpActionUserId: string,
  ) {
    const user1 = await this.userModel.findOne({ usr_id: frpUserId1 });
    const user2 = await this.userModel.findOne({ usr_id: frpUserId2 });
    if (!user1) {
      return Response.error('Người dùng gửi không tồn tại', 400);
    }
    if (!user2) {
      return Response.error('Người dùng nhận không tồn tại', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: frpId,
      frp_userId1: frpUserId1,
      frp_userId2: frpUserId2,
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Lời mời kết bạn không tồn tại', 400);
    }
    await friendship.updateOne({
      frp_status: 'REJECTED',
      frp_actionUserId: frpActionUserId,
    });
    // gửi notification cho người gửi
    const fcmTokens = await this.keyModel.find(
      { tkn_userId: user1._id },
      { tkn_fcmToken: 1 },
    );
    if (fcmTokens.length > 0) {
      try {
        await axios.post(
          `${process.env.GATEWAY_URL}/api/notifications/push-notification`,
          {
            fcmTokens: fcmTokens.map((token) => token.tkn_fcmToken),
            title: `${user2.usr_fullname} đã từ chối lời mời kết bạn`,
            message: 'Bạn đã bị từ chối kết bạn với người dùng',
            data: {
              userId: user1._id,
              senderId: user2._id,
              senderName: user2.usr_fullname,
              senderAvatar: user2.usr_avatar,
              push_type: 'friend_request',
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      } catch (error) {
        console.error('🔥 Error sending notification:', error);
      }
    }
    return Response.success(
      {
        frpId,
        frpStatus: 'accepted',
        friendshipId: 'friend_' + Date.now(),
        rejectedAt: new Date(),
      },
      'Từ chối lời mời kết bạn thành công',
    );
  }

  async getFriends(
    userId: string,
    page: number,
    limit: number,
    search: string,
  ) {
    // Build search match condition
    const searchMatch = search
      ? {
          $or: [
            { usr_fullname: { $regex: search, $options: 'i' } },
            { usr_email: { $regex: search, $options: 'i' } },
            { usr_phone: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const friends = await this.userModel.aggregate(
      getFriendsAggregate(userId, page, limit, search),
    );

    const sumTotal = await this.userModel.aggregate([
      ...getFriendsAggregate(userId, page, limit, search),
      {
        $count: 'total',
      },
    ]);

    const data = friends.map((friend) => Utils.unprefix(friend, 'usr_'));

    return Response.success(
      {
        friends: data,
        total: sumTotal[0]?.total || 0,
        page: page,
        limit: limit,
      },
      'Lấy danh sách bạn bè thành công',
    );
  }

  async searchUsers(search: string, page: number, limit: number) {
    const users = await this.userModel
      .find({
        $or: [
          { usr_fullname: { $regex: search, $options: 'i' } },
          { usr_email: { $regex: search, $options: 'i' } },
          { usr_phone: { $regex: search, $options: 'i' } },
        ],
      })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const sumTotal = await this.userModel.countDocuments({
      $or: [
        { usr_fullname: { $regex: search, $options: 'i' } },
        { usr_email: { $regex: search, $options: 'i' } },
        { usr_phone: { $regex: search, $options: 'i' } },
      ],
    });
    const data = users.map((user) => Utils.unprefix(user.toObject(), 'usr_'));
    return Response.success(
      {
        users: data,
        total: sumTotal,
        page: page,
        limit: limit,
      },
      'Danh sách người dùng được tìm kiếm',
    );
  }

  async removeFriend(friendId: string, actionUserId: string) {
    const friend = await this.userModel.findOne({ usr_id: friendId });
    if (!friend) {
      return Response.error('Người dùng không tồn tại', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      $or: [
        { frp_userId1: friend.usr_id, frp_userId2: actionUserId },
        { frp_userId1: actionUserId, frp_userId2: friend.usr_id },
      ],
    });
    if (!friendship) {
      return Response.error('Bạn không phải là bạn bè với người dùng này', 400);
    }
    await friendship.deleteOne();
    const pairRoomId1 = Utils.pairRoomId(friend.usr_id, actionUserId);
    const pairRoomId2 = Utils.pairRoomId(actionUserId, friend.usr_id);
    // xóa phòng chat
    await this.roomModel.deleteOne({
      $or: [{ room_id: pairRoomId1 }, { room_id: pairRoomId2 }],
    });
    return Response.success(friendship, 'Xóa bạn thành công');
  }
}
