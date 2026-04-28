import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { SocialService } from './social.service';
import { GetBlockedFriendsDto } from '@app/dto';
import { GetFriendByUserIdDto } from '@app/dto';

@Controller()
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // Friend requests
  @GrpcMethod('SocialService', 'SendFriendRequest')
  async sendFriendRequest(data: any) {
    console.log('sendFriendRequest', data);
    return this.socialService.sendFriendRequest(data);
  }

  @GrpcMethod('SocialService', 'GetFriendRequests')
  async getFriendRequests(data: {
    userId: string;
    page: number;
    limit: number;
    type: 'received' | 'sent';
  }) {
    const result = await this.socialService.getFriendRequests(
      data.userId,
      data.page,
      data.limit,
      data.type,
    );
    return result;
  }

  @GrpcMethod('SocialService', 'AcceptFriendRequest')
  async acceptFriendRequest(data: { usr_id: string; senderId: string }) {
    console.log('acceptFriendRequest', data);
    return this.socialService.acceptFriendRequest(data);
  }

  @GrpcMethod('SocialService', 'RejectFriendRequest')
  async rejectFriendRequest(data: { usr_id: string; senderId: string }) {
    console.log('🚀 ~ SocialController ~ rejectFriendRequest ~ data:', data);
    return this.socialService.rejectFriendRequest(data);
  }

  @GrpcMethod('SocialService', 'SearchUsers')
  async searchUsers(data: any) {
    return this.socialService.searchUsers(
      data.search,
      data.page,
      data.limit,
      data.userId,
    );
  }

  @GrpcMethod('SocialService', 'GetFriends')
  async getFriends(data: any) {
    return this.socialService.getFriends(
      data.userId,
      data.page,
      data.limit,
      data.search,
    );
  }

  @GrpcMethod('SocialService', 'RemoveFriend')
  async removeFriend(data: any) {
    return this.socialService.removeFriend(data.friendId, data.actionUserId);
  }

  @GrpcMethod('SocialService', 'BlockFriend')
  async blockFriend(data: any) {
    return this.socialService.blockFriend(data.friendId, data.actionUserId);
  }

  @GrpcMethod('SocialService', 'OpenBlockedFriend')
  async openBlockedFriend(data: any) {
    return this.socialService.openBlockedFriend(
      data.friendId,
      data.actionUserId,
    );
  }

  @GrpcMethod('SocialService', 'GetBlockedFriends')
  async getBlockedFriends(data: GetBlockedFriendsDto) {
    return this.socialService.getBlockedFriends(
      data.userId,
      data.page || 1,
      data.limit || 10,
      data.search || '',
    );
  }

  @GrpcMethod('SocialService', 'getFriendByUserId')
  async getFriendByUserId(data: GetFriendByUserIdDto) {
    return this.socialService.getFriendByUserId(data.userId);
  }

  @GrpcMethod('SocialService', 'GetFriendSuggestions')
  async getFriendSuggestions(data: { userId: string; limit?: number }) {
    return this.socialService.getFriendSuggestions(
      data.userId,
      data.limit ?? 10,
    );
  }
}
