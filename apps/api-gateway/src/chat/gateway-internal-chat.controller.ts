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
  CreateNewMsg(data: Record<string, unknown>): Observable<unknown>;
  MarkReadUpTo(data: Record<string, unknown>): Observable<unknown>;
  HandleReact(data: Record<string, unknown>): Observable<unknown>;
  HandlePinned(data: Record<string, unknown>): Observable<unknown>;
  HandleDeleteForUser(data: Record<string, unknown>): Observable<unknown>;
  HandleDelete(data: Record<string, unknown>): Observable<unknown>;
  RequestCall(data: Record<string, unknown>): Observable<unknown>;
  AcceptCall(data: Record<string, unknown>): Observable<unknown>;
  EndCall(data: Record<string, unknown>): Observable<unknown>;
  GetCallStatus(data: { callId: string }): Observable<unknown>;
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
  checkLearningCardStatus(data: {
    roomId?: string;
    sourceType: 'quiz' | 'flashcard_deck' | 'todo_project';
    sourceIds: string[];
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

  @Post('messages')
  async createMessage(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.CreateNewMsg.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('messages/read-up-to')
  async markReadUpTo(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.MarkReadUpTo.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('messages/react')
  async handleReact(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.HandleReact.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('messages/pinned')
  async handlePinned(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.HandlePinned.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('messages/delete-for-user')
  async handleDeleteForUser(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.HandleDeleteForUser.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('messages/recall')
  async handleDelete(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.HandleDelete.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('calls/request')
  async requestCall(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.RequestCall.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('calls/accept')
  async acceptCall(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.AcceptCall.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('calls/end')
  async endCall(
    @Body() body: Record<string, unknown>,
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.EndCall.bind(this.chatService),
      body,
      20000,
    );
  }

  @Post('calls/status')
  async getCallStatus(
    @Body() body: { callId: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, ['socket']);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.GetCallStatus.bind(this.chatService),
      body,
      10000,
    );
  }

  @Post('rooms/resolve')
  async resolveRoom(
    @Body() body: { roomId: string; userId?: string },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret);

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
    this.assertInternalRequest(internalService, internalSecret);

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
    this.assertInternalRequest(internalService, internalSecret);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.attachMessageAttachments.bind(this.chatService),
      { ...body, messageId },
      30000,
    );
  }

  @Post('messages/learning-card-status')
  async checkLearningCardStatus(
    @Body()
    body: {
      roomId?: string;
      sourceType: 'quiz' | 'flashcard_deck' | 'todo_project';
      sourceIds: string[];
    },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, [
      'learning',
      'filesystem',
    ]);

    return this.gatewayService.dispatchGrpcRequest(
      this.chatService.checkLearningCardStatus.bind(this.chatService),
      body,
      30000,
    );
  }

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
    allowedServices: string[] = ['filesystem', 'learning'],
  ) {
    if (!internalService || !allowedServices.includes(internalService)) {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
