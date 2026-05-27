import { SendFriendRequestDto } from '@app/dto';
import Utils from '@app/helpers/utils';
import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import friendshipModel, {
  Friendship,
} from 'libs/db/src/mongo/model/friendship.model';
import { Response } from 'libs/helpers/response';
import { Model } from 'mongoose';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

interface NotificationGrpcClient {
  PushNotification(data: {
    userId: string;
    title: string;
    content: string;
    data?: any;
  }): any;
}

interface AuthGrpcClient {
  GetUserById(data: { userId: string }): any;
  GetUsersByIds(data: { userIds: string[] }): any;
  SearchUsers(data: {
    keyword: string;
    page: number;
    limit: number;
    excludeUserId?: string;
  }): any;
}

type GrpcResponse<T = any> = {
  statusCode?: number;
  metadata?: T;
};

import { RoomsService } from '../rooms/rooms.service';
import { CreateRoomDto } from '@app/dto/room.dto';
import {
  getFriendsBaseAggregate,
  getFriendsRequestAggregate,
  getBlockedFriendsAggregate,
} from './aggregates/getFriends';
import { getFriendSuggestionsAggregate } from './aggregates/getFriendSuggestions';
import roomModel, { Room } from 'libs/db/src/mongo/model/room.model';
import { SERVICES } from '@app/constants';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class SocialService {
  private notificationGrpcClient: NotificationGrpcClient;
  private authGrpcClient: AuthGrpcClient;

  constructor(
    @InjectModel(friendshipModel.name)
    private readonly friendshipModel: Model<Friendship>,
    @InjectModel(roomModel.name) private readonly roomModel: Model<Room>,
    private readonly roomService: RoomsService,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @Inject('NOTIFICATION_GRPC')
    private readonly notificationGrpc: ClientGrpc,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
  ) {}

  onModuleInit() {
    this.notificationGrpcClient =
      this.notificationGrpc.getService<NotificationGrpcClient>(
        'NotificationService',
      );
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');
  }

  /**
   * Database isolation: fetch user info via gRPC Auth service.
   */
  private async lookupUsersByIds(userIds: string[]): Promise<any[]> {
    if (!userIds.length) return [];
    try {
      const result = await firstValueFrom(
        this.authGrpcClient.GetUsersByIds({ userIds }),
      );
      const users = (result as GrpcResponse<any[]>)?.metadata ?? [];
      return users.map((u: any) => ({
        _id: u._id,
        usr_id: u.id ?? u._id,
        usr_fullname: u.fullname ?? '',
        usr_avatar: u.avatar ?? '',
        usr_email: u.email ?? '',
        usr_phone: u.phone ?? '',
        usr_slug: u.slug ?? '',
      }));
    } catch {
      return [];
    }
  }

  private async lookupUserById(userId: string): Promise<any | null> {
    const users = await this.lookupUsersByIds([userId]);
    return users[0] || null;
  }

  // create friendship

  // Friend requests
  async sendFriendRequest(data: SendFriendRequestDto) {
    const user = await this.lookupUserById(data.frpUserId1);

    if (!user) {
      return Response.error('Người dùng không tồn tại', 400);
    }

    const receiver = await this.lookupUserById(data.frpUserId2);
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
    // gui notification cho nguoi nhan qua gRPC Notification service
    try {
      await firstValueFrom(
        this.notificationGrpcClient.PushNotification({
          userId: receiver.usr_id,
          title: `${user.usr_fullname} da gui loi moi ket ban`,
          content: 'Ban co mot loi moi ket ban moi',
          data: {
            userId: receiver.usr_id,
            senderId: user.usr_id,
            senderName: user.usr_fullname,
            senderAvatar: user.usr_avatar,
            push_type: 'friend_request',
          },
        }),
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
    return Response.success(friendship, 'Gui loi moi ket ban thanh cong');
  }

  async getFriendRequests(
    userId: string,
    page: number,
    limit: number,
    type: string,
  ) {
    // 1. Aggregate: get PENDING friendships involving userId
    const friendships = await this.friendshipModel.aggregate(
      getFriendsRequestAggregate(userId, type),
    );
    const total = friendships.length;

    // 2. Collect "other" user IDs (the person who sent/received the request)
    const otherIds = friendships.map((f) => f.otherId);

    // 3. Hydrate via gRPC
    const users = await this.lookupUsersByIds(otherIds);
    const userMap = new Map(users.map((u) => [u.usr_id, u]));

    // 4. Build response (Friend shape without search — no in-memory filtering)
    //    Paginate in-memory
    const start = (page - 1) * limit;
    const pagedFriendships = friendships.slice(start, start + limit);

    const data = pagedFriendships.map((f: Record<string, any>) => {
      const user = userMap.get(f.otherId);
      return {
        _id: user?._id ?? '',
        id: f.otherId,
        fullname: user?.usr_fullname ?? '',
        email: user?.usr_email ?? '',
        phone: user?.usr_phone ?? '',
        gender: user?.usr_gender ?? '',
        dateOfBirth: user?.usr_dateOfBirth ?? '',
        avatar: user?.usr_avatar ?? '',
        status: user?.usr_status ?? '',
        createdAt: f.createdAt?.toISOString?.() ?? '',
        updatedAt: f.updatedAt?.toISOString?.() ?? '',
        friendship: {
          _id: f._id.toString(),
          frpId: f.frp_id,
          userId1: f.frp_userId1,
          userId2: f.frp_userId2,
          actionUserId: f.frp_actionUserId,
          status: f.frp_status,
          createdAt: f.createdAt?.toISOString?.() ?? '',
          updatedAt: f.updatedAt?.toISOString?.() ?? '',
        },
      };
    });

    return Response.success(
      {
        friendRequests: data,
        total,
        totalPage: Math.ceil(total / limit),
        page,
        limit,
      },
      'Lay danh sach loi moi ket ban thanh cong',
    );
  }

  async acceptFriendRequest({
    usr_id,
    senderId,
  }: {
    usr_id: string;
    senderId: string;
  }) {
    const user1 = await this.lookupUserById(usr_id);
    const user2 = await this.lookupUserById(senderId);
    if (!user1) {
      return Response.error('Nguoi dung gui khong ton tai', 400);
    }
    if (!user2) {
      return Response.error('Nguoi dung nhan khong ton tai', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: Utils.pairRoomId(usr_id, senderId),
      frp_actionUserId: senderId,
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Loi moi ket ban khong ton tai', 400);
    }
    await friendship.updateOne({
      frp_status: 'ACCEPTED',
      frp_actionUserId: usr_id,
    });
    // gui notification cho nguoi gui qua gRPC Notification service
    try {
      await firstValueFrom(
        this.notificationGrpcClient.PushNotification({
          userId: user2.usr_id,
          title: `${user1.usr_fullname} da chap nhan loi moi ket ban`,
          content: 'Ban da duoc ket ban voi nguoi dung',
          data: {
            userId: user1._id,
            senderId: user2._id,
            senderName: user2.usr_fullname,
            senderAvatar: user2.usr_avatar,
            push_type: 'friend_request',
          },
        }),
      );
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
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
    // tao phong chat
    const payload = {
      userId: user1._id.toString(),
      name: `Phong chat ${Utils.pairRoomId(user1.usr_id, user2.usr_id)}`,
      avatar: '',
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
      console.error('Error creating room:', error);
      // rollback loi moi ket ban
      await friendship.updateOne({
        frp_status: 'PENDING',
        frp_actionUserId: senderId,
      });
      return Response.error(
        'Co loi xay ra khi ket ban',
        400,
        'ERROR_CREATE_ROOM',
      );
    }
    return Response.success(result, 'Chap nhan loi moi ket ban thanh cong');
  }

  async rejectFriendRequest({
    usr_id,
    senderId,
  }: {
    usr_id: string;
    senderId: string;
  }) {
    const user1 = await this.lookupUserById(usr_id);
    const user2 = await this.lookupUserById(senderId);
    if (!user1) {
      return Response.error('Nguoi dung gui khong ton tai1', 400);
    }
    if (!user2) {
      return Response.error('Nguoi dung nhan khong ton tai2', 400);
    }
    const friendship = await this.friendshipModel.findOne({
      frp_id: Utils.pairRoomId(usr_id, senderId),
      frp_status: 'PENDING',
    });
    if (!friendship) {
      return Response.error('Loi moi ket ban khong ton tai', 400);
    }
    await friendship.updateOne({
      frp_status: 'REJECTED',
      frp_actionUserId: usr_id,
    });
    // gui notification cho nguoi gui qua gRPC Notification service
    try {
      const response = await firstValueFrom(
        this.notificationGrpcClient.PushNotification({
          userId: user2.usr_id,
          title: `${user1.usr_fullname} da tu choi loi moi ket ban`,
          content: 'Ban da bi tu choi ket ban voi nguoi dung',
          data: {
            userId: user1._id,
            senderId: user1._id,
            senderName: user1.usr_fullname,
            senderAvatar: user1.usr_avatar,
            push_type: 'friend_rejected',
          },
        }),
      );
      const grpcResponse = response as GrpcResponse;
      if (grpcResponse.statusCode !== 200) {
        console.error('Co loi xay ra khi gui notification:', response);
      } else {
        console.log('Gui notification thanh cong:', response);
      }
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
    return Response.success(
      {
        frpId: friendship.frp_id,
        frpStatus: 'accepted',
        friendshipId: 'friend_' + Date.now(),
        rejectedAt: new Date(),
      },
      'Tu choi loi moi ket ban thanh cong',
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

    // 1. Aggregate: get candidate IDs from Friendships (intra-DB only)
    const candidates = await this.friendshipModel.aggregate(
      getFriendSuggestionsAggregate(userId, limit),
    );

    if (!candidates.length) {
      return Response.success({ suggestions: [], total: 0 }, 'No suggestions');
    }

    // 2. Hydrate candidate user info via gRPC
    const candidateIds = candidates.map((c) => c._id);
    const users = await this.lookupUsersByIds(candidateIds);
    const userMap = new Map(users.map((u) => [u.usr_id, u]));

    // 3. Hydrate mutualVia user names (up to 3 per candidate)
    const viaIds = [
      ...new Set(candidates.flatMap((c) => c.mutualVia || [])),
    ];
    const viaUsers = await this.lookupUsersByIds(viaIds);
    const viaNameMap = new Map(viaUsers.map((u) => [u.usr_id, u.usr_fullname]));

    // 4. Build suggestions matching FriendSuggestion proto
    const suggestions = candidates.map((c) => {
      const user = userMap.get(c._id);
      return {
        _id: user?._id ?? '',
        id: user?.usr_id ?? c._id,
        fullname: user?.usr_fullname ?? '',
        avatar: user?.usr_avatar ?? '',
        email: user?.usr_email ?? '',
        mutualFriendsCount: c.mutualFriendsCount ?? 0,
        mutualSamples: (c.mutualVia || []).map(
          (v: string) => viaNameMap.get(v) || '',
        ),
      };
    });

    return Response.success(
      {
        suggestions,
        total: suggestions.length,
      },
      'Lay goi y ket ban thanh cong',
    );
  }

  async getFriends(
    userId: string,
    page: number,
    limit: number,
    search: string,
  ) {
    // 1. Aggregate: get all accepted friendships (intra-DB only)
    const friendships = await this.friendshipModel.aggregate(
      getFriendsBaseAggregate(userId),
    );

    // 2. Extract friend IDs and hydrate via gRPC
    const friendIds = friendships.map((f) => f.friendId);
    const users = await this.lookupUsersByIds(friendIds);
    const userMap = new Map(users.map((u) => [u.usr_id, u]));

    // 3. Build friend records matching Friend proto shape
    let data = friendships.map((f: Record<string, any>) => {
      const user = userMap.get(f.friendId);
      return {
        _id: user?._id ?? '',
        id: f.friendId,
        fullname: user?.usr_fullname ?? '',
        email: user?.usr_email ?? '',
        phone: user?.usr_phone ?? '',
        gender: user?.usr_gender ?? '',
        dateOfBirth: user?.usr_dateOfBirth ?? '',
        avatar: user?.usr_avatar ?? '',
        status: user?.usr_status ?? '',
        createdAt: f.createdAt?.toISOString?.() ?? '',
        updatedAt: f.updatedAt?.toISOString?.() ?? '',
        friendship: {
          _id: f._id.toString(),
          frpId: f.frp_id,
          userId1: f.frp_userId1,
          userId2: f.frp_userId2,
          actionUserId: f.frp_actionUserId,
          status: f.frp_status,
          createdAt: f.createdAt?.toISOString?.() ?? '',
          updatedAt: f.updatedAt?.toISOString?.() ?? '',
        },
      };
    });

    // 4. Apply search filter in-memory (user data now lives in auth DB)
    if (search) {
      const lowerSearch = search.toLowerCase();
      data = data.filter(
        (f) =>
          f.fullname?.toLowerCase().includes(lowerSearch) ||
          f.email?.toLowerCase().includes(lowerSearch) ||
          f.phone?.toLowerCase().includes(lowerSearch),
      );
    }

    // 5. Paginate in-memory
    const total = data.length;
    const pagedData = data.slice((page - 1) * limit, page * limit);

    return Response.success(
      {
        friends: pagedData,
        total,
        totalPage: Math.ceil(total / limit),
        page,
        limit,
      },
      'Lay danh sach ban be thanh cong',
    );
  }

  async searchUsers(
    search: string,
    page: number,
    limit: number,
    userId: string,
  ) {
    // 1. Search users via gRPC Auth service (replaces cross-DB aggregate)
    const result = await firstValueFrom(
      this.authGrpcClient.SearchUsers({
        keyword: search,
        page,
        limit,
        excludeUserId: userId,
      }),
    );

    const users: any[] = (result as GrpcResponse<any[]>)?.metadata ?? [];

    // 2. Check friendship status with each user
    const candidateIds = users.map((u: any) => u.id ?? u._id);
    const friendships = await this.friendshipModel.find({
      $or: [
        { frp_userId1: userId, frp_userId2: { $in: candidateIds } },
        { frp_userId2: userId, frp_userId1: { $in: candidateIds } },
      ],
    });
    const friendshipMap = new Map<string, Record<string, any>>();
    for (const f of friendships) {
      const otherId =
        f.frp_userId1 === userId ? f.frp_userId2 : f.frp_userId1;
      friendshipMap.set(otherId, f.toObject());
    }

    // 3. Filter out users with any existing relationship (matches old behavior:
    //    friends, pending, blocked, rejected are all excluded from search).
    const existingRelationUserIds = new Set<string>();
    for (const f of friendships) {
      const otherId =
        f.frp_userId1 === userId ? f.frp_userId2 : f.frp_userId1;
      existingRelationUserIds.add(otherId);
    }

    // 4. Build response: only users without existing relationships
    const data = users
      .filter((u: any) => {
        const uid = u.id ?? u._id;
        return !existingRelationUserIds.has(uid);
      })
      .map((u: any) => ({
        _id: u._id ?? '',
        id: u.id ?? '',
        fullname: u.fullname ?? '',
        email: u.email ?? '',
        phone: u.phone ?? '',
        gender: u.gender ?? '',
        dateOfBirth: u.dateOfBirth ?? '',
        avatar: u.avatar ?? '',
        status: u.status ?? '',
        createdAt: u.createdAt ?? '',
        updatedAt: u.updatedAt ?? '',
      }));

    return Response.success(
      {
        users: data,
        total: data.length,
        totalPage: Math.ceil(data.length / limit),
        page,
        limit,
      },
      'Danh sach nguoi dung duoc tim kiem',
    );
  }

  async removeFriend(friendId: string, actionUserId: string) {
    const friend = await this.lookupUserById(friendId);
    if (!friend) {
      return Response.error('Nguoi dung khong ton tai', 400, 'USER_NOT_FOUND');
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
        'Ban da xoa ket ban voi nguoi dung nay',
        400,
        'DATA_NOT_FOUND',
      );
    }
    await friendship.deleteOne();
    const pairRoomId1 = Utils.pairRoomId(friend.usr_id, actionUserId);
    const pairRoomId2 = Utils.pairRoomId(actionUserId, friend.usr_id);
    // xoa phong chat
    await this.roomModel.deleteOne({
      $or: [{ room_id: pairRoomId1 }, { room_id: pairRoomId2 }],
    });
    return Response.success(friendship, 'Xoa ban thanh cong');
  }

  async blockFriend(friendId: string, actionUserId: string) {
    const friend = await this.lookupUserById(friendId);
    if (!friend) {
      return Response.error('Nguoi dung khong ton tai', 400, 'USER_NOT_FOUND');
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
        'Ban da chan nguoi dung nay',
        400,
        'DATA_NOT_FOUND',
      );
    }
    return Response.success(friendship, 'Chan ban thanh cong');
  }

  async openBlockedFriend(friendId: string, actionUserId: string) {
    const friend = await this.lookupUserById(friendId);
    if (!friend) {
      return Response.error('Nguoi dung khong ton tai', 400, 'USER_NOT_FOUND');
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
      return Response.error('Ban da mo chan ban be nay', 400, 'DATA_NOT_FOUND');
    }

    return Response.success(friendship, 'Mo chan thanh cong');
  }

  async getBlockedFriends(
    userId: string,
    page: number = 1,
    limit: number = 10,
    search: string = '',
  ) {
    // 1. Aggregate: get blocked friendships (intra-DB only)
    const friendships = await this.friendshipModel.aggregate(
      getBlockedFriendsAggregate(userId),
    );

    // 2. Extract blocked user IDs and hydrate via gRPC
    const blockedUserIds = friendships.map((f) => f.blockedUserId);
    const users = await this.lookupUsersByIds(blockedUserIds);
    const userMap = new Map(users.map((u) => [u.usr_id, u]));

    // 3. Build blocked user records
    let data = friendships.map((f: Record<string, any>) => {
      const user = userMap.get(f.blockedUserId);
      return {
        _id: user?._id ?? '',
        id: f.blockedUserId,
        fullname: user?.usr_fullname ?? '',
        email: user?.usr_email ?? '',
        phone: user?.usr_phone ?? '',
        gender: user?.usr_gender ?? '',
        dateOfBirth: user?.usr_dateOfBirth ?? '',
        avatar: user?.usr_avatar ?? '',
        status: user?.usr_status ?? '',
        createdAt: f.createdAt?.toISOString?.() ?? '',
        updatedAt: f.updatedAt?.toISOString?.() ?? '',
        friendship: {
          _id: f._id.toString(),
          frpId: f.frp_id,
          userId1: f.frp_userId1,
          userId2: f.frp_userId2,
          actionUserId: f.frp_actionUserId,
          status: f.frp_status,
          createdAt: f.createdAt?.toISOString?.() ?? '',
          updatedAt: f.updatedAt?.toISOString?.() ?? '',
        },
      };
    });

    // 4. Apply search filter in-memory
    if (search) {
      const lowerSearch = search.toLowerCase();
      data = data.filter(
        (f) =>
          f.fullname?.toLowerCase().includes(lowerSearch) ||
          f.email?.toLowerCase().includes(lowerSearch) ||
          f.phone?.toLowerCase().includes(lowerSearch),
      );
    }

    // 5. Paginate in-memory
    const total = data.length;
    const pagedData = data.slice((page - 1) * limit, page * limit);

    return Response.success(
      {
        blockedUsers: pagedData,
        total,
        totalPage: Math.ceil(total / limit),
        page,
        limit,
      },
      'Lay danh sach nguoi dung da chan thanh cong',
    );
  }

  async getFriendByUserId(userId: string) {
    const friend = await this.lookupUserById(userId);
    if (!friend) {
      return Response.error('Nguoi dung khong ton tai', 400, 'USER_NOT_FOUND');
    }
    return Response.success(
      {
        _id: friend._id ?? '',
        id: friend.usr_id ?? '',
        fullname: friend.usr_fullname ?? '',
        email: friend.usr_email ?? '',
        phone: friend.usr_phone ?? '',
        gender: friend.usr_gender ?? '',
        dateOfBirth: friend.usr_dateOfBirth ?? '',
        avatar: friend.usr_avatar ?? '',
        status: friend.usr_status ?? '',
        slug: friend.usr_slug ?? '',
      },
      'Lay thong tin ban thanh cong',
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
