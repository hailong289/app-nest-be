import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway.service';
import { SERVICES } from '@app/constants/services';
import {
  AddMemberRoomDto,
  CreateRoomDto,
  GetRoomType,
  LeavingRoomDto,
  OptionsType,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';

interface ChatGrpcService {
  createRoom(data: CreateRoomDto): any;
  leavingRoom(data: LeavingRoomDto): any;
  removeMember(data: RemoveMemberRoomDto): any;
  addMember(data: AddMemberRoomDto): any;
  getRooms(data: GetRoomType): any;
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
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.createRoom.bind(this.chatGrpcService),
      body,
    );
    return rl;
  }

  @Patch('rooms/leaving')
  async leavingRoom(
    @Body()
    body: LeavingRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.leavingRoom.bind(this.chatGrpcService),
      body,
    );
    return rl;
  }
  @Patch('rooms/remove')
  async removeMember(
    @Body()
    body: RemoveMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.removeMember.bind(this.chatGrpcService),
      body,
    );
    return rl;
  }
  @Patch('rooms/add')
  async addMember(
    @Body()
    body: AddMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.addMember.bind(this.chatGrpcService),
      body,
    );
    return rl;
  }
  @Get('rooms')
  async GetRooms(
    @Req() req: { user?: { _id?: string } },
    @Query()
    options: Partial<OptionsType> = {},
  ) {
    console.log('query', options);
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
    console.log('data', data);
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.getRooms.bind(this.chatGrpcService),
      data,
    );
    return rl;
  }
}
