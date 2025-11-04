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
import { SERVICES } from '@app/constants/services';
import {
  AddMemberRoomDto,
  ChangelinkAvatarRoomDto,
  ChangeNameRoomDto,
  CreateRoomDto,
  GetRoomDto,
  GetRoomType,
  LeavingRoomDto,
  OptionsType,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';
import { ChatGateway } from '../ws/chat/chat-gateway';
import { REDISKEY } from '@app/constants/RedisKey';

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
}

@Controller('chat')
export class GatewayChatController {
  private RoomGrpcService: RoomGrpcService;
  private readonly key = REDISKEY;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly chatGateway: ChatGateway,
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
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;

    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.createRoom.bind(this.RoomGrpcService),
      body,
    )) as { metadata?: { members?: Array<{ id?: string }> } };

    // Emit WebSocket event to room members
    const room = result?.metadata;
    if (room?.members && Array.isArray(room.members)) {
      const memberIds: string[] = room.members
        .filter(
          (member): member is { id: string } =>
            member != null && typeof member.id === 'string',
        )
        .map((member) => this.key.ROOM_CLIENT(member.id));

      // Emit to each member individually
      console.log('Room member keys:', memberIds);
      memberIds.forEach((memberId: string) => {
        this.chatGateway.io.to(memberId).emit('room:upset', room);
      });
    }

    return result;
  }

  @Patch('rooms/leaving')
  async leavingRoom(
    @Body()
    body: LeavingRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.leavingRoom.bind(this.RoomGrpcService),
      body,
    );
  }

  @Patch('rooms/members/remove')
  async removeMember(
    @Body()
    body: RemoveMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.removeMember.bind(this.RoomGrpcService),
      body,
    );
  }

  @Patch('rooms/add')
  async addMember(
    @Body()
    body: AddMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.addMember.bind(this.RoomGrpcService),
      body,
    );
  }
  @Get('rooms')
  async GetRooms(
    @Req() req: { user?: { _id?: string } },
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
  async GetRoom(
    @Req() req: { user?: { _id?: string } },
    @Param('id') id: string,
  ) {
    const body: GetRoomDto = {
      userId: req.user?._id,
      roomId: id,
    };
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
      body,
    );
  }

  @Patch('rooms/avatar')
  async ChangeAvatar(
    @Body()
    body: ChangelinkAvatarRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeAvatar.bind(this.RoomGrpcService),
      body,
    );
  }

  @Patch('rooms/name')
  async ChangeName(
    @Body()
    body: ChangeNameRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeName.bind(this.RoomGrpcService),
      body,
    );
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
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeNickName.bind(this.RoomGrpcService),
      body,
    );
  }
}
