import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  Req,
  Patch,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants';
import {
  SendFriendRequestDto,
  GetFriendRequestsDto,
  AcceptFriendRequestDto,
  RejectFriendRequestDto,
  SearchUsersDto,
  GetFriendsDto,
  RemoveFriendDto,
  BlockFriendDto,
  OpenBlockedFriendDto,
} from '@app/dto';
import { GatewayService } from '../../gateway/gateway.service';
import type { AuthenticatedRequest } from 'libs/types';

interface SocialGrpcService {
  SendFriendRequest(data: SendFriendRequestDto): Observable<any>;
  GetFriendRequests(data: GetFriendRequestsDto): Observable<any>;
  AcceptFriendRequest(data: AcceptFriendRequestDto): Observable<any>;
  RejectFriendRequest(data: RejectFriendRequestDto): Observable<any>;
  SearchUsers(data: SearchUsersDto): Observable<any>;
  GetFriends(data: GetFriendsDto): Observable<any>;
  RemoveFriend(data: RemoveFriendDto): Observable<any>;
  BlockFriend(data: BlockFriendDto): Observable<any>;
  OpenBlockedFriend(data: OpenBlockedFriendDto): Observable<any>;
}

@Controller('social')
export class GatewaySocialController {
  private socialService: SocialGrpcService;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}

  onModuleInit() {
    this.socialService =
      this.chatClient.getService<SocialGrpcService>('SocialService');
  }

  /**
   *
   * @param req: AuthenticatedRequest
   * @param receiverId: string
   * @returns SendFriendRequestResponse
   * @description Gửi lời mời kết bạn
   * @example POST /social/friend-requests
   * @example POST /social/friend-requests?receiverId=123
   * @example POST /social/friend-requests?receiverId=456
   * @example POST /social/friend-requests?receiverId=789
   * @example POST /social/friend-requests?receiverId=101
   */
  @Post('friend-requests')
  async sendFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Body('receiverId') receiverId: string,
  ) {
    const data = {
      frpUserId1: req.user._id,
      frpUserId2: receiverId,
      frpActionUserId: req.user._id,
    };

    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.SendFriendRequest.bind(this.socialService),
      data,
    );
  }

  /**
   *
   * @param req: AuthenticatedRequest
   * @param page: number
   * @param limit: number
   * @returns GetFriendRequestsResponse
   * @description Lấy danh sách lời mời kết bạn
   * @example GET /social/friend-requests?page=1&limit=10
   * @example GET /social/friend-requests?page=2&limit=20
   */
  @Get('friend-requests')
  async getFriendRequests(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type: string = 'received', // 'received', 'sent' bao gồm người nhận và người gửi
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.GetFriendRequests.bind(this.socialService),
      {
        userId: req.user.usr_id,
        page: page || 1,
        limit: limit || 10,
        type: type,
      },
    );
  }

  /**
   *
   * @param requestId: string
   * @param data: any
   * @returns AcceptFriendRequestResponse
   * @description Chấp nhận lời mời kết bạn
   * @example POST /social/friend-requests/123/accept
   * @example POST /social/friend-requests/456/accept
   * @example POST /social/friend-requests/789/accept
   */

  @Post('friend-requests/:requestId/accept')
  async acceptFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Query('senderId') senderId: string,
  ) {
    const data = {
      frpId: requestId,
      frpUserId1: senderId, // người gửi lời mời kết bạn
      frpUserId2: req.user.usr_id,
      frpActionUserId: req.user.usr_id,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.AcceptFriendRequest.bind(this.socialService),
      data,
    );
  }

  @Post('friend-requests/:requestId/reject')
  async rejectFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Query('senderId') senderId: string,
  ) {
    const data = {
      frpId: requestId,
      frpUserId1: senderId, // người gửi lời mời kết bạn
      frpUserId2: req.user.usr_id,
      frpActionUserId: req.user.usr_id,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.RejectFriendRequest.bind(this.socialService),
      data,
    );
  }

  @Get('users/friends')
  async getFriends(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.GetFriends.bind(this.socialService),
      {
        userId: req.user.usr_id,
        page: page || 1,
        limit: limit || 10,
        search: search || '',
      },
    );
  }

  @Get('users/search')
  async searchUsers(
    @Req() req: AuthenticatedRequest,
    @Query('search') search: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const data = {
      currentUserId: req.user.usr_id,
      search: search || '',
      page: page || 1,
      limit: limit || 10,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.SearchUsers.bind(this.socialService),
      data,
    );
  }

  @Delete('friends/:friendId')
  async removeFriend(
    @Req() req: AuthenticatedRequest,
    @Param('friendId') friendId: string,
  ) {
    const data = {
      friendId: friendId,
      actionUserId: req.user.usr_id,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.RemoveFriend.bind(this.socialService),
      data,
    );
  }

  @Patch('friends/:friendId/block')
  async blockFriend(
    @Req() req: AuthenticatedRequest,
    @Param('friendId') friendId: string,
  ) {
    const data = {
      friendId: friendId,
      actionUserId: req.user.usr_id,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.BlockFriend.bind(this.socialService),
      data,
    );
  }

  @Patch('friends/:friendId/open-blocked')
  async openBlockedFriend(
    @Req() req: AuthenticatedRequest,
    @Param('friendId') friendId: string,
  ) {
    const data = {
      friendId: friendId,
      actionUserId: req.user.usr_id,
    };
    return this.gatewayService.dispatchGrpcRequest(
      this.socialService.OpenBlockedFriend.bind(this.socialService),
      data,
    );
  }
}
