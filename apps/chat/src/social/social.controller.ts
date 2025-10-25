import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { SocialService } from './social.service';

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
  async getFriendRequests(data: any) {
    return this.socialService.getFriendRequests(
      data.userId,
      data.page,
      data.limit,
      data.type,
    );
  }

  @GrpcMethod('SocialService', 'AcceptFriendRequest')
  async acceptFriendRequest(data: any) {
    console.log('acceptFriendRequest', data);
    return this.socialService.acceptFriendRequest(
      data.frpId,
      data.frpUserId1,
      data.frpUserId2,
      data.frpActionUserId,
    );
  }

  @GrpcMethod('SocialService', 'RejectFriendRequest')
  async rejectFriendRequest(data: any) {
    return this.socialService.rejectFriendRequest(
      data.frpId,
      data.frpUserId1,
      data.frpUserId2,
      data.frpActionUserId,
    );
  }

  @GrpcMethod('SocialService', 'SearchUsers')
  async searchUsers(data: any) {
    return this.socialService.searchUsers(data.search, data.page, data.limit);
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
}
