import { Body, Controller, Inject, Patch, Post, Req } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway.service';
import { SERVICES } from '@app/constants/services';
import { CreateRoomDto } from './dto/create-room.dto';
import { LeavingRoomDto } from './dto/leaving-room.dto';
import { removeMeberRoomDto } from './dto/remove-member.dto';

interface ChatGrpcService {
  createRoom(data: CreateRoomDto): any;
  leavingRoom(data: LeavingRoomDto): any;
  removeMember(data: removeMeberRoomDto): any;
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
    body: removeMeberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.removeMember.bind(this.chatGrpcService),
      body,
    );
    return rl;
  }
}
