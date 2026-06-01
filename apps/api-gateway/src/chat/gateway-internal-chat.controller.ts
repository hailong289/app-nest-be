import {
  Body,
  Controller,
  Headers,
  Inject,
  OnModuleInit,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants/services';
import { GatewayService } from '../gateway/gateway.service';

interface ChatInternalGrpcService {
  resolveRoomForUser(data: {
    roomId: string;
    userId?: string;
  }): Observable<unknown>;
  getRoomMembers(data: {
    roomId: string;
    userId?: string;
  }): Observable<unknown>;
  attachMessageAttachments(data: {
    messageId: string;
    roomId?: string;
    actorUserId: string;
    attachmentIds: string[];
  }): Observable<unknown>;
}

@Controller('internal/chat')
export class GatewayInternalChatController implements OnModuleInit {
  private chatService!: ChatInternalGrpcService;

  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.chatService =
      this.chatClient.getService<ChatInternalGrpcService>('ChatService');
  }

  @Post('rooms/resolve')
  async resolveRoom(
    @Body() body: { roomId: string; userId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertFilesystemRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.resolveRoomForUser.bind(this.chatService),
      body,
      30000,
    );
  }

  @Post('rooms/check-access')
  async checkRoomAccess(
    @Body() body: { roomId: string; userId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    return this.resolveRoom(body, internalService, internalSecret);
  }

  @Post('rooms/members')
  async getRoomMembers(
    @Body() body: { roomId: string; userId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertFilesystemRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.getRoomMembers.bind(this.chatService),
      body,
      30000,
    );
  }

  @Post('messages/:messageId/attachments')
  async attachMessageAttachments(
    @Param('messageId') messageId: string,
    @Body()
    body: {
      roomId?: string;
      actorUserId: string;
      attachmentIds: string[];
    },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertFilesystemRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.attachMessageAttachments.bind(this.chatService),
      { ...body, messageId },
      30000,
    );
  }

  private assertFilesystemRequest(
    internalService?: string,
    internalSecret?: string,
  ) {
    if (internalService !== 'filesystem') {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
