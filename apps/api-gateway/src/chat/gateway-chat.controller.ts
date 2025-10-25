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

export interface ChatGrpcService {
  createRoom(data: any): any;
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
  private chatGrpcService: ChatGrpcService;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {}
  onModuleInit() {
    this.chatGrpcService =
      this.chatClient.getService<ChatGrpcService>('ChatService');
  }
  // Chat endpoints
  @Post('rooms')
  async createRoom(
    @Body()
    body: CreateRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.createRoom.bind(this.chatGrpcService),
      body,
    );
  }

  @Patch('rooms/leaving')
  async leavingRoom(
    @Body()
    body: LeavingRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    return await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.leavingRoom.bind(this.chatGrpcService),
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
      this.chatGrpcService.removeMember.bind(this.chatGrpcService),
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
      this.chatGrpcService.addMember.bind(this.chatGrpcService),
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
      this.chatGrpcService.getRooms.bind(this.chatGrpcService),
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
      this.chatGrpcService.getRoom.bind(this.chatGrpcService),
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
      this.chatGrpcService.changeAvatar.bind(this.chatGrpcService),
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
      this.chatGrpcService.changeName.bind(this.chatGrpcService),
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
      this.chatGrpcService.changeNickName.bind(this.chatGrpcService),
      body,
    );
  }
}
