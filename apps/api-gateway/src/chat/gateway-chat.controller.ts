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
  getMsgFromRoom(data: any): any;
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
    @Req() req: { user?: { _id?: string; usr_id?: string } },
  ) {
    body.userId = req.user?._id;

    const result = await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.leavingRoom.bind(this.RoomGrpcService),
      body,
    );
    const usrId = req.user?.usr_id;
    if (usrId) {
      this.chatGateway.io.to(this.key.ROOM_CLIENT(usrId)).emit('room:remove', {
        roomId: body.roomId,
      });
    }
    return result;
  }

  @Patch('rooms/members/remove')
  async removeMember(
    @Body()
    body: RemoveMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const result = await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.removeMember.bind(this.RoomGrpcService),
      body,
    );
    body.memberIds.forEach((m) => {
      this.chatGateway.io.to(this.key.ROOM_CLIENT(m)).emit('room:remove', {
        roomId: body.roomId,
      });
    });
    return result;
  }

  @Patch('rooms/add')
  async addMember(
    @Body()
    body: AddMemberRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.addMember.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    const roomsUpdate = await Promise.all(
      result.metadata.members.map(async (r) => {
        const data: GetRoomDto = {
          userId: r.user_id,
          roomId: result.metadata.roomId,
        };
        const roomData = (await this.gatewayService.dispatchGrpcRequest(
          this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
          data,
        )) as ChatGatewayResponse;
        return {
          socketRoom: this.key.ROOM_CLIENT(r.id),
          roomData: roomData.metadata,
        };
      }),
    );

    roomsUpdate.forEach(({ socketRoom, roomData }) => {
      this.chatGateway.io.to(socketRoom).emit('room:upset', roomData);
    });
    const safeResult =
      result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, any>)
        : { data: result };

    return {
      metadata: true,
      ...safeResult,
    };
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
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeAvatar.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;
    console.log('🚀 ~ GatewayChatController ~ ChangeAvatar ~ result:', result);
    const roomsUpdate = await Promise.all(
      result.metadata.members.map(async (r) => {
        const data: GetRoomDto = {
          userId: r.user_id,
          roomId: result.metadata.roomId,
        };
        const roomData = (await this.gatewayService.dispatchGrpcRequest(
          this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
          data,
        )) as ChatGatewayResponse;
        return {
          socketRoom: this.key.ROOM_CLIENT(r.id),
          roomData: roomData.metadata,
        };
      }),
    );

    roomsUpdate.forEach(({ socketRoom, roomData }) => {
      this.chatGateway.io.to(socketRoom).emit('room:upset', roomData);
    });
    return result;
  }

  @Patch('rooms/name')
  async ChangeName(
    @Body()
    body: ChangeNameRoomDto,
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeName.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;
    const roomsUpdate = await Promise.all(
      result.metadata.members.map(async (r) => {
        const data: GetRoomDto = {
          userId: r.user_id,
          roomId: result.metadata.roomId,
        };
        const roomData = (await this.gatewayService.dispatchGrpcRequest(
          this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
          data,
        )) as ChatGatewayResponse;
        return {
          socketRoom: this.key.ROOM_CLIENT(r.id),
          roomData: roomData.metadata,
        };
      }),
    );

    roomsUpdate.forEach(({ socketRoom, roomData }) => {
      this.chatGateway.io.to(socketRoom).emit('room:upset', roomData);
    });
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
    @Req() req: { user?: { _id?: string } },
  ) {
    body.userId = req.user?._id;
    const result = (await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.changeNickName.bind(this.RoomGrpcService),
      body,
    )) as ChatOutChangeGatewayResponse;

    const roomsUpdate = await Promise.all(
      result.metadata.members.map(async (r) => {
        const data: GetRoomDto = {
          userId: r.user_id,
          roomId: result.metadata.roomId,
        };
        const roomData = (await this.gatewayService.dispatchGrpcRequest(
          this.RoomGrpcService.getRoom.bind(this.RoomGrpcService),
          data,
        )) as ChatGatewayResponse;
        return {
          socketRoom: this.key.ROOM_CLIENT(r.id),
          roomData: roomData.metadata,
        };
      }),
    );

    roomsUpdate.forEach(({ socketRoom, roomData }) => {
      this.chatGateway.io.to(socketRoom).emit('room:upset', roomData);
    });
    return result;
  }

  @Get('messages/:roomId')
  async GetMsgFromRoom(
    @Req() req: { user?: { _id?: string } },
    @Param('roomId') roomId: string,
    @Query()
    query: {
      limit?: number;
      type?: 'new' | 'old';
      msgId?: string;
    },
  ) {
    const data = {
      userId: req.user?._id,
      roomId,
      ...query,
    };
    console.log('🚀 ~ GatewayChatController ~ GetMsgFromRoom ~ data:', data);
    return await this.gatewayService.dispatchGrpcRequest(
      this.RoomGrpcService.getMsgFromRoom.bind(this.RoomGrpcService),
      data,
    );
  }
}
