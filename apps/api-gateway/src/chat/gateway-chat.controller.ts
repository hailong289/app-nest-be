import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { GatewayService } from '../gateway.service';
import { SERVICES } from '@app/constants/services';
import { CreateRoomDto } from 'apps/chat/src/rooms/dto/create-room.dto';

interface ChatGrpcService {
  createRoom(data: CreateRoomDto): any;
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
    data: CreateRoomDto,
    @Req() req: { user?: { id?: string } },
  ) {
    const rl = await this.gatewayService.dispatchGrpcRequest(
      this.chatGrpcService.createRoom,
      {
        userId:
          req.user && typeof req.user.id === 'string' ? req.user.id : null,
        ...data,
      },
    );
    console.log('🚀 ~ GatewayChatController ~ createRoom ~ rl:', rl);
    return rl;
  }
}
