import { KafkaEvent, SendFriendRequestDto } from '@app/dto';
import Utils from '@app/helpers/utils';
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import friendshipModel, {
  Friendship,
} from 'libs/db/src/mongo/model/friendship.model';
import { Response } from 'libs/helpers/response';
import { Model } from 'mongoose';
import { RoomsService } from '../rooms/rooms.service';
import { CreateRoomDto } from '@app/dto/room.dto';
import {
  getFriendsAggregate,
  getFriendsBaseAggregate,
  getFriendsRequestAggregate,
  getBlockedFriendsAggregate,
} from './aggregates/getFriends';
import { getFriendSuggestionsAggregate } from './aggregates/getFriendSuggestions';
import { SERVICES } from '@app/constants';
import { ClientKafka } from '@nestjs/microservices';
import {
  GatewayClientService,
  type UserSummary,
} from '../gateway-client/gateway-client.service';

@Injectable()
export class SocialService {
  private readonly log = new Logger(SocialService.name);

  constructor(
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    private readonly roomService: RoomsService,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    private readonly gatewayClient: GatewayClientService,
  ) {}

  // Friend requests

  /**
   * Gửi lời mời kết bạn.
   * frpUserId1 = Mongo _id của sender (từ req.user._id).
   * frpUserId2 = usr_id của receiver (business id — gateway resolve sang _id để gửi notification).
   */
  async sendFriendRequest(data: SendFriendRequestDto) {
    // frpUserId1 là Mongo _id của sender (đã pass đúng từ gateway)
    const senderMongoId = data.frpUserId1;

    // Lấy sender summary qua gateway để lấy usr_id + display info
    const senderSummary = await this.gatewayClient.getUserSummary(senderMongoId);
    if (!senderSummary) {
      return Response.error('Người dùng không tồn tại', 400);
    }

    // frpUserId2 là usr_id của receiver → resolve sang Mongo _id + summary
    const receiverSummaries = await this.gatewayClient.resolveUsersByBusinessIds([data.frpUserId2]);
    const receiverSummary = receiverSummaries[0];
    if (!receiverSummary) {
      return Response.error('Người nhận không tồn tại', 400);
    }

    if (senderSummary.usr_id === receiverSummary.usr_id) {
      throw new BadGatewayException('Bạn không thể gửi lời kết bạn cho chính mình');
    }

    const existingFriendship = await this.friendshipModel.findOne({
      frp_userId1: senderSummary.usr_id,
      frp_userId2: receiverSummary.usr_id,
      frp_status: 'PENDING',
    });

    if (existingFriendship) {
      return Response.error('Bạn đã gửi lời mời kết bạn cho người này', 400);
    }

    const friendship = await this.friendshipModel.findOneAndUpdate(
      {
        frp_id: Utils.pairRoomId(senderSummary.usr_id, receiverSummary.usr_id),
      },
      {
        frp_userId1: senderSummary.usr_id,
        frp_userId2: receiverSummary.usr_id,
        frp_actionUserId: senderSummary.usr_id,
        frp_status: 'PENDING',
      },
      {
        new: true,
        upsert: true,
      },
    );

    // Notification dùng Mongo _id (không dùng fcmToken trực tiếp)
    void Utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.PUSH_NOTIFICATION_USERS,
      {
        userIds: [receiverSummary._id],   // Mongo _id
        title: `${senderSummary.usr_fullname} đã gửi lời mời kết bạn`,
        message: 'Bạn có một lời mời kết bạn mới',
        saveToDb: true,
        data: {
          userId: receiverSummary._id,
          userBusinessId: receiverSummary.usr_id,
          senderId: senderSummary._id,           // Mongo _id
          senderBusinessId: senderSummary.usr_id,
          senderName: senderSummary.usr_fullname,
          senderAvatar: senderSummary.usr_avatar,
          push_type: 'friend_request',
        },
      },
    );

    return Response.success(friendship, 'Gửi lời mời kết bạn thành công');
  }

  async getFriendRequests(
    usrId: string,   // business usr_id
    page: number,
    limit: number,
    type: string,
  ) {
    // Query Friendships (chat DB) trước
    const friendRequests = await this.friendshipModel.aggregate([
      ...getFriendsRequestAggregate(usrId, type),
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const totalAgg: { total: number }[] = await this.friendshipModel.aggregate([
      ...getFriendsRequestAggregate(usrId, type),
      { $count: 'total' },
    ]);

    // Collect friend usr_ids để hydrate
    const friendUsrIds: string[] = friendRequests.map(
      (r: Record<string, any>) => r.friendUsrId as string,
    );
    let userMap: Map<string, UserSummary> = new Map();
    if (friendUsrIds.length > 0) {
      const users = await this.gatewayClient.resolveUsersByBusinessIds(friendUsrIds);
      userMap = new Map(users.map((u) => [u.usr_id, u]));
    }

    const data = friendRequests.map((request: Record<string, any>) => {
      const user = userMap.get(request.friendUsrId as string);
      return {
        _id: user?._id ?? '',
        id: user?.usr_id ?? request.friendUsrId,
        fullname: user?.usr_fullname ?? '',
        avatar: user?.usr_avatar ?? '',
        email: user?.usr_email ?? '',
        friendship: Utils.unprefix(request, 'frp_'),
      };
    });

    return Response.success(
      {
        friendRequests: data,
        total: totalAgg[0]?.total || 0,
        totalPage: Math.ceil((totalAgg[0]?.total || 0) / limit),
        page,
        limit,
      },
      'Lấy danh sách lời mời kết bạn thành công',
    );
  }

  async acceptFriendRequest({
    usr_id,
    senderId,
  }: {
    usr_id: string;   // usr_id của người nhận (current user)
    senderId: string; // usr_id của người gửi
  }) {
    // Resolve cả 2 user qua gateway để lấy Mongo _id + display info
    const [acceptorList, senderList] = await Promise.all([
      this.gatewayClient.resolveUsersByBusinessIds([usr_id]),
      this.gatewayClient.resolveUsersByBusinessIds([senderId]),
    ]);
    const acceptor = acceptorList[0];
    const sender = senderList[0];

    if (!acceptor) return Response.error('Người dùng gửi không tồn tại', 400);
    if (!sender) return Response.error('Người dùng nhận không tồn tại', 400);

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

    // Notification với Mongo _id
    void Utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.PUSH_NOTIFICATION_USERS,
      {
        userIds: [sender._id],   // Mongo _id
        title: `${acceptor.usr_fullname} đã chấp nhận lời mời kết bạn`,
        message: 'Bạn đã được kết bạn với người dùng',
        saveToDb: true,
        data: {
          userId: acceptor._id,
          userBusinessId: acceptor.usr_id,
          senderId: sender._id,
          senderBusinessId: sender.usr_id,
          senderName: sender.usr_fullname,
          senderAvatar: sender.usr_avatar,
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

    // Tạo phòng chat private — userId là Mongo _id của acceptor
    const payload = {
      userId: acceptor._id,
      name: `Phòng chat ${Utils.pairRoomId(acceptor.usr_id, sender.usr_id)}`,
      avatar: '',
      type: 'private',
      memberIds: [sender.usr_id], // roomService.create resolve memberIds qua gateway
    } as CreateRoomDto;

    try {
      const room = (await this.roomService.create(payload)) as ChatGatewayResponse;
      if (room.statusCode !== 200) {
        await friendship.updateOne({
          frp_status: 'PENDING',
          frp_actionUserId: senderId,
        });
        return Response.error(room.message, room.statusCode, room.reasonStatusCode, 'ERROR_CREATE_ROOM');
      }
      if (room?.metadata) {
        result.room = room.metadata;
      }
    } catch (error) {
      this.log.error('🔥 Error creating room:', error);
      await friendship.updateOne({
        frp_status: 'PENDING',
        frp_actionUserId: senderId,
      });
      return Response.error('Có lỗi xảy ra khi kết bạn', 400, 'ERROR_CREATE_ROOM');
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
    const [rejectorList, senderList] = await Promise.all([
      this.gatewayClient.resolveUsersByBusinessIds([usr_id]),
      this.gatewayClient.resolveUsersByBusinessIds([senderId]),
    ]);
    const rejector = rejectorList[0];
    const sender = senderList[0];

    if (!rejector) return Response.error('Người dùng gửi không tồn tại1', 400);
    if (!sender) return Response.error('Người dùng nhận không tồn tại2', 400);

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
        userIds: [sender._id],  // Mongo _id
        title: `${rejector.usr_fullname} đã từ chối lời mời kết bạn`,
        message: 'Bạn đã bị từ chối kết bạn với người dùng',
        saveToDb: true,
        data: {
          userId: rejector._id,
          userBusinessId: rejector.usr_id,
          senderId: rejector._id,
          senderBusinessId: rejector.usr_id,
          senderName: rejector.usr_fullname,
          senderAvatar: rejector.usr_avatar,
          push_type: 'friend_rejected',
        },
      },
    );

    return Response.success(
      {
        frpId: friendship.frp_id,
        frpStatus: 'REJECTED',
        friendshipId: 'friend_' + Date.now(),
        rejectedAt: new Date(),
      },
      'Từ chối lời mời kết bạn thành công',
    );
  }

  /**
   * Friend suggestions: tính từ Friendships graph (chat DB), hydrate profiles qua gateway.
   */
  async getFriendSuggestions(usrId: string, limit = 10) {
    if (!usrId) {
      return Response.success({ suggestions: [], total: 0 }, 'Empty');
    }

    type SuggestionRow = {
      _id: string;       // candidate usr_id
      mutualFriendsCount: number;
      mutualVia: string[];
    };

    // Pipeline chỉ dùng Friendships (chat-owned), không $lookup Users
    const suggestions: SuggestionRow[] = await this.friendshipModel.aggregate(
      getFriendSuggestionsAggregate(usrId, limit),
    );

    if (!suggestions.length) {
      return Response.success({ suggestions: [], total: 0 }, 'Lấy gợi ý kết bạn thành công');
    }

    // Hydrate user summaries qua gateway
    const candidateUsrIds = suggestions.map((s) => s._id);
    const users = await this.gatewayClient.resolveUsersByBusinessIds(candidateUsrIds);
    const userMap = new Map(users.map((u) => [u.usr_id, u]));

    return Response.success(
      {
        suggestions: suggestions.map((s) => {
          const user = userMap.get(s._id);
          return {
            _id: user?._id ?? '',
            id: s._id,
            fullname: user?.usr_fullname ?? '',
            avatar: user?.usr_avatar ?? '',
            email: user?.usr_email ?? '',
            mutualFriendsCount: s.mutualFriendsCount ?? 0,
            mutualSamples: [],
          };
        }),
        total: suggestions.length,
      },
      'Lấy gợi ý kết bạn thành công',
    );
  }

  async getFriends(
    usrId: string,
    page: number,
    limit: number,
    search: string,
  ) {
    let allowedFriendUsrIds: string[] | undefined;
    const keyword = search?.trim();
    if (keyword) {
      const searched = await this.gatewayClient.searchUsers(
        keyword,
        1,
        100,
        usrId,
      );
      allowedFriendUsrIds = searched.users.map((user) => user.usr_id);
      if (allowedFriendUsrIds.length === 0) {
        return Response.success(
          { friends: [], total: 0, totalPage: 0, page, limit },
          'Lấy danh sách bạn bè thành công',
        );
      }
    }

    // Query Friendships (chat DB) trước — aggregate không $lookup Users nữa
    const friends = await this.friendshipModel.aggregate(
      getFriendsAggregate(usrId, page, limit, search, allowedFriendUsrIds),
    );

    const sumTotal: { total: number }[] = await this.friendshipModel.aggregate([
      ...getFriendsBaseAggregate(usrId, search, allowedFriendUsrIds),
      { $count: 'total' },
    ]);

    // Hydrate user summaries từ gateway
    const friendUsrIds: string[] = friends.map((f: Record<string, any>) => f.friendUsrId as string);
    let userMap: Map<string, UserSummary> = new Map();
    if (friendUsrIds.length > 0) {
      const users = await this.gatewayClient.resolveUsersByBusinessIds(friendUsrIds);
      userMap = new Map(users.map((u) => [u.usr_id, u]));
    }

    const data = (friends || []).map((friend: Record<string, any>) => {
      const user = userMap.get(friend.friendUsrId as string);
      return {
        _id: user?._id ?? '',
        id: user?.usr_id ?? friend.friendUsrId,
        fullname: user?.usr_fullname ?? '',
        avatar: user?.usr_avatar ?? '',
        email: user?.usr_email ?? '',
        friendship: Utils.unprefix(friend, 'frp_'),
      };
    });

    return Response.success(
      {
        friends: data || [],
        total: sumTotal[0]?.total || 0,
        totalPage: Math.ceil((sumTotal[0]?.total || 0) / limit),
        page,
        limit,
      },
      'Lấy danh sách bạn bè thành công',
    );
  }

  async searchUsers(
    search: string,
    page: number,
    limit: number,
    usrId: string,  // business usr_id của current user
  ) {
    // Search qua auth gateway
    const gatewayResult = await this.gatewayClient.searchUsers(search, page, limit, usrId);
    const users = gatewayResult.users;

    if (!users.length) {
      return Response.success(
        { users: [], total: 0, totalPage: 0, page, limit },
        'Danh sách người dùng được tìm kiếm',
      );
    }

    // Enrich friendship status từ Friendships (chat DB)
    const candidateUsrIds = users.map((u) => u.usr_id);
    const friendships = await this.friendshipModel.find({
      $or: [
        { frp_userId1: usrId, frp_userId2: { $in: candidateUsrIds } },
        { frp_userId2: usrId, frp_userId1: { $in: candidateUsrIds } },
      ],
    }).lean();

    const friendshipMap = new Map<string, { status: string }>();
    for (const f of friendships) {
      const otherId = f.frp_userId1 === usrId ? f.frp_userId2 : f.frp_userId1;
      friendshipMap.set(otherId, { status: f.frp_status });
    }

    const data = users.map((u) => ({
      _id: u._id,
      id: u.usr_id,
      fullname: u.usr_fullname,
      avatar: u.usr_avatar,
      email: u.usr_email,
      friendship: friendshipMap.get(u.usr_id) ?? null,
    }));

    return Response.success(
      {
        users: data,
        total: gatewayResult.total,
        totalPage: gatewayResult.totalPage,
        page,
        limit,
      },
      'Danh sách người dùng được tìm kiếm',
    );
  }

  async removeFriend(friendId: string, actionUsrId: string) {
    // friendId là usr_id của người cần xóa
    const resolved = await this.gatewayClient.resolveUsersByBusinessIds([
      friendId,
      actionUsrId,
    ]);
    if (resolved.length < 2) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }

    const friendship = await this.friendshipModel.findOne({
      $or: [
        { frp_userId1: friendId, frp_userId2: actionUsrId },
        { frp_userId1: actionUsrId, frp_userId2: friendId },
      ],
      frp_status: 'ACCEPTED',
    });
    if (!friendship) {
      return Response.error('Bạn đã xóa kết bạn với người dùng này', 400, 'DATA_NOT_FOUND');
    }
    await friendship.deleteOne();

    // Xóa phòng chat private
    const pairRoomId = Utils.pairRoomId(friendId, actionUsrId);
    await this.roomService.deletePrivateRoomByPairId(pairRoomId);

    return Response.success(friendship, 'Xóa bạn thành công');
  }

  async blockFriend(friendId: string, actionUsrId: string) {
    const resolved = await this.gatewayClient.resolveUsersByBusinessIds([
      friendId,
      actionUsrId,
    ]);
    if (resolved.length < 2) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }

    const friendship = await this.friendshipModel.findOneAndUpdate(
      {
        $or: [
          { frp_userId1: friendId, frp_userId2: actionUsrId },
          { frp_userId1: actionUsrId, frp_userId2: friendId },
        ],
      },
      {
        frp_status: 'BLOCKED',
        frp_actionUserId: actionUsrId,
      },
      {
        new: true,
        upsert: true,
      },
    );
    if (!friendship) {
      return Response.error('Bạn đã chặn người dùng này', 400, 'DATA_NOT_FOUND');
    }
    return Response.success(friendship, 'Chặn bạn thành công');
  }

  async openBlockedFriend(friendId: string, actionUsrId: string) {
    const resolved = await this.gatewayClient.resolveUsersByBusinessIds([
      friendId,
      actionUsrId,
    ]);
    if (resolved.length < 2) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }

    const friendship = await this.friendshipModel.findOneAndDelete({
      $or: [
        { frp_userId1: friendId, frp_userId2: actionUsrId },
        { frp_userId1: actionUsrId, frp_userId2: friendId },
      ],
      frp_status: 'BLOCKED',
      frp_actionUserId: actionUsrId,
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
    const blocked = await this.friendshipModel.aggregate([
      ...getBlockedFriendsAggregate(userId),
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const totalAgg: { total: number }[] = await this.friendshipModel.aggregate([
      ...getBlockedFriendsAggregate(userId),
      { $count: 'total' },
    ]);

    // Hydrate user summaries
    const friendUsrIds: string[] = blocked.map((f: Record<string, any>) => f.friendUsrId as string);
    let userMap: Map<string, UserSummary> = new Map();
    if (friendUsrIds.length > 0) {
      const users = await this.gatewayClient.resolveUsersByBusinessIds(friendUsrIds);
      userMap = new Map(users.map((u) => [u.usr_id, u]));
    }

    let data = (blocked || []).map((friend: Record<string, any>) => {
      const user = userMap.get(friend.friendUsrId as string);
      return {
        _id: user?._id ?? '',
        id: user?.usr_id ?? friend.friendUsrId,
        fullname: user?.usr_fullname ?? '',
        avatar: user?.usr_avatar ?? '',
        email: user?.usr_email ?? '',
        friendship: Utils.unprefix(friend, 'frp_'),
      };
    });

    // Client-side search filter (since gateway doesn't know about friendship context)
    if (search) {
      const lc = search.toLowerCase();
      data = data.filter(
        (d) =>
          d.fullname.toLowerCase().includes(lc) ||
          (d.email ?? '').toLowerCase().includes(lc),
      );
    }

    return Response.success(
      {
        blockedUsers: data || [],
        total: totalAgg[0]?.total || 0,
        totalPage: Math.ceil((totalAgg[0]?.total || 0) / limit),
        page,
        limit,
      },
      'Lấy danh sách người dùng đã chặn thành công',
    );
  }

  async getFriendByUserId(usrId: string) {
    const users = await this.gatewayClient.resolveUsersByBusinessIds([usrId]);
    const user = users[0];
    if (!user) {
      return Response.error('Người dùng không tồn tại', 400, 'USER_NOT_FOUND');
    }
    return Response.success(
      {
        _id: user._id,
        id: user.usr_id,
        fullname: user.usr_fullname,
        avatar: user.usr_avatar,
        email: user.usr_email,
      },
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
  };
}
