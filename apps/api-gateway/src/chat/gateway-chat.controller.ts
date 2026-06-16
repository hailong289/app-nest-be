import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway/gateway.service';
import {
  GuestCallLinkService,
  type CreateGuestCallLinkDto,
} from './guest-call-link.service';
import { SERVICES } from '@app/constants/services';
import {
  AddMemberRoomDto,
  ChangelinkAvatarRoomDto,
  ChangeNameRoomDto,
  ChangeRoleMemberDto,
  CreateRoomDto,
  DeletedRoomDto,
  GetRoomDto,
  GetRoomType,
  LeavingRoomDto,
  MutedRoomDto,
  OptionsType,
  PinnedRoomDto,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';
import type { AuthenticatedRequest } from 'libs/types';

import { REDISKEY } from '@app/constants/RedisKey';
interface ChatOutChangeGatewayResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    members: [
      {
        id: string;
        user_id: string;
        role: string;
        joinedAt: string;
      },
    ];
    roomId: string;
  };
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
export interface RoomGrpcService {
  createRoom(data: any): Promise<{ metadata?: any }>;
  leavingRoom(data: any): any;
  removeMember(data: any): any;
  addMember(data: any): any;
  getRooms(data: any): any;
  getRoom(data: any): any;
  changeAvatar(data: any): any;
  changeName(data: any): any;
  changeNickName(data: any): any;
  changeRole(data: any): any;
  pinnendRoom(data: any): any;
  mutedRoom(data: any): any;
  deletedRoom(data: any): Promise<ChatGatewayResponse>;
  getMsgFromRoom(data: any): any;
  getDocumentsFromRoom(data: any): any;
  syncEvents(data: any): any;
}

@Controller('chat')
export class GatewayChatController {
  private RoomGrpcService: RoomGrpcService;
  private readonly key = REDISKEY;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly guestCallLinkService: GuestCallLinkService,
  ) {}
  onModuleInit() {
    this.RoomGrpcService =
      this.chatClient.getService<RoomGrpcService>('ChatService');
  }
  // Chat endpoints
  @Post('rooms')
  async createRoom(
    @Body()
    body: CreateRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;

    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.createRoom.bind(this.RoomGrpcService),
      body,
    )) as { metadata?: { members?: Array<{ id?: string }> } };

    return result;
  }

  @Patch('rooms/leaving')
  async leavingRoom(
    @Body()
    body: LeavingRoomDto,
    @Req() req: { user?: { _id?: string; usr_id?: string } },
  ) {
    body.userId = req.user?._id;

    const result = await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.leavingRoom.bind(this.RoomGrpcService),
      body,
    );

    return result;
  }

  @Patch('rooms/members/remove')
  async removeMember(
    @Body()
    body: RemoveMemberRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.removeMember.bind(this.RoomGrpcService),
      body,
    );

    return result;
  }

  @Patch('rooms/add')
  async addMember(
    @Body()
    body: AddMemberRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.addMember.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    return {
      ...result,
    };
  }
  @Get('rooms')
  async GetRooms(
    @Req() req: AuthenticatedRequest,
    @Query()
    options: Partial<OptionsType> = {},
  ) {
    const safeOptions: OptionsType = {
      q: '',
      limit: 1000,
      offset: 0,
      type: 'all',
      ...options,
    };
    const data: GetRoomType = {
      userId: req.user?._id,
      options: safeOptions,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getRooms.bind(this.RoomGrpcService),
      data,
    );
  }

  @Get('room/:id')
  async GetRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const body: GetRoomDto = {
      userId: req.user?._id,
      roomId: id,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
      body,
    );
  }

  /**
   * Catch-up sync: client pull change-feed (outbox) kể từ con trỏ `sinceSeq`.
   * Trả { events[], nextSeq, hasMore, requireFullResync }. Xem
   * plan/DONG_BO_EVENT_SYNC.md (Sprint 3 / Phần 3c).
   */
  @Get('sync/events')
  async SyncEvents(
    @Req() req: AuthenticatedRequest,
    @Query('sinceSeq') sinceSeq?: string,
    @Query('limit') limit?: string,
  ) {
    const data = {
      userId: req.user?._id,
      sinceSeq: Number(sinceSeq ?? 0) || 0,
      limit: Number(limit ?? 200) || 200,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.syncEvents.bind(this.RoomGrpcService),
      data,
    );
  }

  @Patch('rooms/avatar')
  async ChangeAvatar(
    @Body()
    body: ChangelinkAvatarRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeAvatar.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    return result;
  }

  @Patch('rooms/name')
  async ChangeName(
    @Body()
    body: ChangeNameRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeName.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    return result;
  }

  @Patch('rooms/nick-name')
  async ChangeNickName(
    @Body()
    body: {
      roomId: string;
      name: string;
      memberId: string;
      userId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeNickName.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    return result;
  }

  @Patch('rooms/role')
  async ChangeRole(
    @Body()
    body: ChangeRoleMemberDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeRole.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    return result;
  }

  @Patch('rooms/pinned')
  async PinnendRoom(
    @Body()
    body: PinnedRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.pinnendRoom.bind(this.RoomGrpcService),
      body,
    )) as ChatGatewayResponse;

    return result;
  }

  @Patch('rooms/muted')
  async MutedRoom(
    @Body()
    body: MutedRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.mutedRoom.bind(this.RoomGrpcService),
      body,
    )) as ChatGatewayResponse;

    return result;
  }

  @Patch('rooms/deleted')
  async DeletedRoom(
    @Body()
    body: DeletedRoomDto,
    @Req() req: AuthenticatedRequest,
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.deletedRoom.bind(this.RoomGrpcService),
      body,
    )) as ChatGatewayResponse;
    return result;
  }

  @Get('messages/:roomId')
  async GetMsgFromRoom(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Query()
    query: {
      limit?: number;
      // type=new + msgId → load messages with `_id > msgId` (delta
      // sync after FE has a local cache). type=old + msgId → load
      // older for infinite-scroll. No type → return latest `limit`.
      type?: 'new' | 'old';
      msgId?: string;
    },
  ) {
    const data = {
      userId: req.user?._id,
      roomId,
      ...query,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getMsgFromRoom.bind(this.RoomGrpcService),
      data,
    );
  }

  @Get('documents/:roomId')
  async GetDocumentsFromRoom(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Query()
    query: {
      limit?: number;
      page?: number;
    },
  ) {
    const data = {
      userId: req.user?._id,
      roomId,
      limit: query.limit || 20,
      page: query.page || 1,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getDocumentsFromRoom.bind(this.RoomGrpcService),
      data,
    );
  }

  /** Create signed guest call invite link (host only). */
  @Post('call/guest-link')
  async createGuestCallLink(
    @Body() body: CreateGuestCallLinkDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.guestCallLinkService.createLink(req.user.usr_id, body);
  }

  /** Revoke a guest call invite link by jti. */
  @Post('call/guest-link/revoke')
  async revokeGuestCallLink(
    @Body() body: { jti: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.guestCallLinkService.revokeLink(req.user.usr_id, body.jti);
  }

  /** Public verify endpoint for guest tokens before joining. */
  @Get('call/guest-link/verify')
  async verifyGuestCallLink(@Query('token') token: string) {
    return this.guestCallLinkService.verifyToken(token);
  }
}
