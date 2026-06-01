import { KafkaEvent, SendFriendRequestDto } from '@app/dto';
import Utils from '@app/helpers/utils';
import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import friendshipModel, {
  Friendship,
} from 'libs/db/src/mongo/model/friendship.model';
import userModel, { User } from 'libs/db/src/mongo/model/user.model';
import { Response } from 'libs/helpers/response';
import { Model, Types } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRoomDto } from '@app/dto/room.dto';
import {
  getFriendsAggregate,
  getFriendsBaseAggregate,
  getFriendsRequestAggregate,
  searchUsersAggregate,
  getBlockedFriendsAggregate,
} from './aggregates/getFriends';
import { getFriendSuggestionsAggregate } from './aggregates/getFriendSuggestions';
import roomModel, { Room } from 'libs/db/src/mongo/model/room.model';
import { SERVICES } from '@app/constants';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(userModel.name) private readonly userModel: Model<User>,
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    @InjectModel(roomModel.name) private readonly roomModel: Model<Room>,
    private readonly roomService: RoomsService,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
  ) {}
  // creeate friendship

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
    if (user.usr_id == receiver.usr_id) {
      throw new BadGatewayException(
        'Bạn không thể gửi lời kết bạn cho chính mình',
      );
    }
    const existingFriendship = await this.friendshipModel.findOne({
      frp_userId1: user.usr_id,
      frp_userId2: receiver.usr_id,
      frp_status: 'PENDING',
    });

    if (existingFriendship) {
      return Response.error('Bạn đã gửi lời mời kết bạn cho người này', 400);
    }

    // const friendship = await this.friendshipModel.create({
    //   frp_userId1: user.usr_id,
    //   frp_userId2: receiver.usr_id,
    //   frp_actionUserId: user.usr_id,
    //   frp_status: 'PENDING',
    //   frp_id: Utils.pairRoomId(user.usr_id, receiver.usr_id),
    // });
    const friendship = await this.friendshipModel.findOneAndUpdate(
      {
        frp_id: Utils.pairRoomId(user.usr_id, receiver.usr_id),
      },
      {
        frp_userId1: user.usr_id,
        frp_userId2: receiver.usr_id,
        frp_actionUserId: user.usr_id,
        frp_status: 'PENDING',
      },
      {
        new: true,
        upsert: true,
      },
    );
    void Utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.PUSH_NOTIFICATION_USERS,
      {
        userIds: [receiver._id.toString()],
        title: `${user.usr_fullname} đã gửi lời mời kết bạn`,
        message: 'Bạn có một lời mời kết bạn mới',
        saveToDb: true,
        data: {
          userId: receiver._id.toString(),
          userBusinessId: receiver.usr_id,
          senderId: user._id.toString(),
          senderBusinessId: user.usr_id,
          senderName: user.usr_fullname,
          senderAvatar: user.usr_avatar,
          push_type: 'friend_request',
        },
      },
    );
    return Response.success(friendship, 'Gửi lời mời kết bạn thành công');
  }

  async getFriendRequests(
    userId: string,
    page: number,
    limit: number,
    type: string,
  ) {
    const friendRequests = await this.friendshipModel.aggregate([
      ...getFriendsRequestAggregate(userId, type),
      { $sort: { 'friendship.updatedAt': -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const total: { total: number }[] = await this.friendshipModel.aggregate([
      ...getFriendsRequestAggregate(userId, type),
      { $count: 'total' },
    ]);

    const data = friendRequests.map((request: Record<string, any>) => {
      return {
        ...Utils.unprefix(request, 'usr_'),
        friendship: Utils.unprefix(request.friendship, 'frp_'),
      };
    });
    console.log('🚀 ~ SocialService ~ data:', data);

    return Response.success(
      {
        friendRequests: data,
        total: total[0]?.total || 0,
        totalPage: Math.ceil(total[0]?.total || 0 / limit),
        page: page,
        limit: limit,
      },
      'Lấy danh sách lời mời kết bạn thành công',
    );
  }

  async acceptFriendRequest({
    usr_id,
    senderId,
  }: {
    usr_id: string;
    senderId: string;
  }) {
    const user1 = await this.userModel.findOne({ usr_id: usr_id });
    const user2 = await this.userModel.findOne({ usr_id: senderId });
    if (!user1) {
      return Response.error('Người dùng gửi không tồn tại', 400);
    }
    if (!user2) {
      return Response.error('Người dùng nhận không tồn tại', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: Utils.pairRoomId(usr_id, senderId),
      frp_actionUserId: senderId,
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Lời mời kết bạn không tồn tại', 400);
    }
    await friendship.updateOne({
      frp_status: 'ACCEPTED',
      frp_actionUserId: usr_id,
    });
    void Utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.PUSH_NOTIFICATION_USERS,
      {
        userIds: [user2._id.toString()],
        title: `${user1.usr_fullname} đã chấp nhận lời mời kết bạn`,
        message: 'Bạn đã được kết bạn với người dùng',
        saveToDb: true,
        data: {
          userId: user1._id.toString(),
          userBusinessId: user1.usr_id,
          senderId: user2._id.toString(),
          senderBusinessId: user2.usr_id,
          senderName: user2.usr_fullname,
          senderAvatar: user2.usr_avatar,
          push_type: 'friend_request',
        },
      },
    );
    const result: {
      frpId: string;
      frpStatus: string;
      friendshipId: string;
      acceptedAt: Date;
      room?: ChatGatewayResponse['metadata'] | null;
    } = {
      frpId: friendship.frp_id,
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
      const room = (await this.roomService.create(
        payload,
      )) as ChatGatewayResponse;
      if (room.statusCode !== 200) {
        await friendship.updateOne({
          frp_status: 'PENDING',
          frp_actionUserId: senderId,
        });
        return Response.error(
          room.message,
          room.statusCode,
          room.reasonStatusCode,
          'ERROR_CREATE_ROOM',
        );
      }
      if (room && room.metadata) {
        result.room = room.metadata;
      }
    } catch (error) {
      console.error('🔥 Error creating room:', error);
      // rollback lời mời kết bạn
      await friendship.updateOne({
        frp_status: 'PENDING',
        frp_actionUserId: senderId,
      });
      return Response.error(
        'Có lỗi xảy ra khi kết bạn',
        400,
        'ERROR_CREATE_ROOM',
      );
    }
    return Response.success(result, 'Chấp nhận lời mời kết bạn thành công');
  }

  async rejectFriendRequest({
    usr_id,
    senderId,
  }: {
    usr_id: string;
    senderId: string;
  }) {
    console.log(
      '🚀 ~ SocialService ~ rejectFriendRequest ~ senderId:',
      senderId,
    );
    const user1 = await this.userModel.findOne({ usr_id: usr_id });
    const user2 = await this.userModel.findOne({ usr_id: senderId });
    if (!user1) {
      return Response.error('Người dùng gửi không tồn tại1', 400);
    }
    if (!user2) {
      return Response.error('Người dùng nhận không tồn tại2', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: Utils.pairRoomId(usr_id, senderId),
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Lời mời kết bạn không tồn tại', 400);
    }
    await friendship.updateOne({
      frp_status: 'REJECTED',
      frp_actionUserId: usr_id,
    });
    void Utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.PUSH_NOTIFICATION_USERS,
      {
        userIds: [user2._id.toString()],
        title: `${user1.usr_fullname} đã từ chối lời mời kết bạn`,
        message: 'Bạn đã bị từ chối kết bạn với người dùng',
        saveToDb: true,
        data: {
          userId: user1._id.toString(),
          userBusinessId: user1.usr_id,
          senderId: user1._id.toString(),
          senderBusinessId: user1.usr_id,
          senderName: user1.usr_fullname,
          senderAvatar: user1.usr_avatar,
          push_type: 'friend_rejected',
        },
      },
    ).then((response) => {
      if (response.statusCode !== 200) {
        console.error('🔥 Có lỗi xảy ra khi gửi notification:', response);
      } else {
        console.log('🔥 Gửi notification thành công:', response);
      }
    });
    return Response.success(
      {
        frpId: friendship.frp_id,
        frpStatus: 'accepted',
        friendshipId: 'friend_' + Date.now(),
        rejectedAt: new Date(),
      },
      'Từ chối lời mời kết bạn thành công',
    );
  }

  /**
   * Friend-of-friend suggestions for `userId`. Returns up to `limit`
   * candidates ranked by mutual-friend count, descending. Self / existing
   * friends / blocked / pending / rejected relationships are excluded.
   *
   * The pipeline is non-trivial — see
   * `aggregates/getFriendSuggestions.ts` for the per-stage rationale.
   * Caller is the gRPC controller which wraps this in a Response envelope.
   */
  async getFriendSuggestions(userId: string, limit = 10) {
    if (!userId) {
      return Response.success({ suggestions: [], total: 0 }, 'Empty');
    }
    type SuggestionRow = {
      _id: string;
      id: string;
      fullname: string;
      avatar: string;
      email: string;
      mutualFriendsCount: number;
      mutualSamples: string[];
    };
    const suggestions: SuggestionRow[] = await this.userModel.aggregate(
      getFriendSuggestionsAggregate(userId, limit),
    );
    return Response.success(
      {
        suggestions: suggestions.map((s) => ({
          _id: s._id ?? '',
          id: s.id ?? '',
          fullname: s.fullname ?? '',
          avatar: s.avatar ?? '',
          email: s.email ?? '',
          mutualFriendsCount: s.mutualFriendsCount ?? 0,
          mutualSamples: Array.isArray(s.mutualSamples) ? s.mutualSamples : [],
        })),
        total: suggestions.length,
      },
      'Lấy gợi ý kết bạn thành công',
    );
  }

  async getFriends(
    userId: string,
    page: number,
    limit: number,
    search: string,
  ) {
    const friends = await this.friendshipModel.aggregate(
      getFriendsAggregate(userId, page, limit, search),
    );

    const sumTotal: { total: number }[] = await this.friendshipModel.aggregate([
      ...getFriendsBaseAggregate(userId, search),
      {
        $count: 'total',
      },
    ]);

    const data = (friends || []).map((friend: Record<string, any>) => {
      return {
        ...Utils.unprefix(friend, 'usr_'),
        friendship: Utils.unprefix(friend.friendship, 'frp_'),
      };
    });

    return Response.success(
      {
        friends: data || [], // Đảm bảo luôn là mảng, không bao giờ undefined
        total: sumTotal[0]?.total || 0,
        totalPage: Math.ceil((sumTotal[0]?.total || 0) / limit),
        page: page,
        limit: limit,
      },
      'Lấy danh sách bạn bè thành công',
    );
  }

  async searchUsers(
    search: string,
    page: number,
    limit: number,
    userId: string,
  ) {
    const users = await this.userModel.aggregate([
      ...searchUsersAggregate(search, page, limit, userId),
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          usr_id: 1,
          usr_fullname: 1,
          usr_email: 1,
          usr_phone: 1,
          usr_gender: 1,
          usr_dateOfBirth: 1,
          usr_avatar: 1,
          usr_status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);

    const totalAgg: { total: number }[] = await this.userModel.aggregate([
      ...searchUsersAggregate(search, page, limit, userId),
      { $count: 'total' },
    ]);

    const data = users.map((user) => Utils.unprefix(user, 'usr_'));
    return Response.success(
      {
        users: data,
        total: totalAgg[0]?.total || 0,
        totalPage: Math.ceil(totalAgg[0]?.total || 0 / limit),
        page: page,
        limit: limit,
      },
      'Danh sách người dùng được tìm kiếm',
    );
  }

  async removeFriend(friendId: string, actionUserId: string) {
    const friend = await this.userModel.findOne({ usr_id: friendId });
    if (!friend) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }
    const friendship = await this.friendshipModel.findOne({
      $or: [
        { frp_userId1: friend.usr_id, frp_userId2: actionUserId },
        { frp_userId1: actionUserId, frp_userId2: friend.usr_id },
      ],
      frp_status: 'ACCEPTED',
    });
    if (!friendship) {
      return Response.error(
        'Bạn đã xóa kết bạn với người dùng này',
        400,
        'DATA_NOT_FOUND',
      );
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

  async blockFriend(friendId: string, actionUserId: string) {
    const friend = await this.userModel.findOne({ usr_id: friendId });
    if (!friend) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }
    const friendship = await this.friendshipModel.findOneAndUpdate(
      {
        $or: [
          { frp_userId1: friend.usr_id, frp_userId2: actionUserId },
          { frp_userId1: actionUserId, frp_userId2: friend.usr_id },
        ],
      },
      {
        frp_status: 'BLOCKED',
        frp_actionUserId: actionUserId,
      },
      {
        new: true,
        upsert: true,
      },
    );
    if (!friendship) {
      return Response.error(
        'Bạn đã chặn người dùng này',
        400,
        'DATA_NOT_FOUND',
      );
    }
    return Response.success(friendship, 'Chặn bạn thành công');
  }

  async openBlockedFriend(friendId: string, actionUserId: string) {
    const friend = await this.userModel.findOne({ usr_id: friendId });
    if (!friend) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }
    const friendship = await this.friendshipModel.findOneAndDelete({
      $or: [
        { frp_userId1: friend.usr_id, frp_userId2: actionUserId },
        { frp_userId1: actionUserId, frp_userId2: friend.usr_id },
      ],
      frp_status: 'BLOCKED',
      frp_actionUserId: actionUserId,
    });
    if (!friendship) {
      return Response.error('Bạn đã mở chặn bạn bè này', 400, 'DATA_NOT_FOUND');
    }

    return Response.success(friendship, 'Mở chặn thành công');
  }

  async getBlockedFriends(
    userId: string,
    page: number = 1,
    limit: number = 10,
    search: string = '',
  ) {
    const searchMatch = search
      ? {
          $or: [
            { usr_fullname: { $regex: search, $options: 'i' } },
            { usr_email: { $regex: search, $options: 'i' } },
            { usr_phone: { $regex: search, $options: 'i' } },
          ],
        }
      : {};
    const blockedFriends = await this.friendshipModel.aggregate([
      ...getBlockedFriendsAggregate(userId),
      { $match: searchMatch },
      { $sort: { 'friendship.updatedAt': -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const totalAgg: { total: number }[] = await this.friendshipModel.aggregate([
      ...getBlockedFriendsAggregate(userId),
      { $match: searchMatch },
      { $count: 'total' },
    ]);
    const data = blockedFriends.map((friend: Record<string, any>) => {
      return {
        ...Utils.unprefix(friend, 'usr_'),
        friendship: Utils.unprefix(friend.friendship, 'frp_'),
      };
    });

    return Response.success(
      {
        blockedUsers: data || [], // Đảm bảo luôn là mảng, không bao giờ undefined
        total: totalAgg[0]?.total || 0,
        totalPage: Math.ceil((totalAgg[0]?.total || 0) / limit),
        page: page,
        limit: limit,
      },
      'Lấy danh sách người dùng đã chặn thành công',
    );
  }

  async getFriendByUserId(userId: string) {
    const friend = await this.userModel.findOne({ usr_id: userId });
    if (!friend) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }
    return Response.success(
      Utils.unprefix(friend, 'usr_'),
      'Lấy thông tin bạn thành công',
    );
  }
}
interface ChatGatewayResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    msgId: string;
    members: Array<Record<string, any>>;
    roomId: string;
    // Có thể bổ sung các trường khác nếu cần
  };
}
