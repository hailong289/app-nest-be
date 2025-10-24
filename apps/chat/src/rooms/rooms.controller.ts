import { Controller, Body } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  ChangelinkAvatarRoomDto,
  ChangeNameRoomDto,
  ChangeNickNameMemberDto,
  CreateRoomDto,
  GetRoomType,
  LeavingRoomDto,
  RemoveMemberRoomDto,
} from '@app/dto/room.dto';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @GrpcMethod('ChatService', 'CreateRoom')
  async create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @GrpcMethod('ChatService', 'LeavingRoom')
  async leavingRoom(@Body() body: LeavingRoomDto) {
    return await this.roomsService.leavedRoom(body);
  }
  @GrpcMethod('ChatService', 'RemoveMember')
  async removeMbr(@Body() payload: RemoveMemberRoomDto) {
    return this.roomsService.removeMemberByAdmin(payload);
  }
  @GrpcMethod('ChatService', 'AddMember')
  async addMbr(@Body() payload: RemoveMemberRoomDto) {
    return this.roomsService.addMemberInRoom(payload);
  }
  @GrpcMethod('ChatService', 'GetRooms')
  async GetRooms(@Body() payload: GetRoomType) {
    return this.roomsService.GetRooms(payload);
  }

  @GrpcMethod('ChatService', 'GetRoom')
  async GetRoom(@Body() payload: { userId: string; roomId: string }) {
    return this.roomsService.GetRoom(payload);
  }

  @GrpcMethod('ChatService', 'ChangeAvatar')
  async ChangeAvatar(@Body() payload: ChangelinkAvatarRoomDto) {
    return this.roomsService.changeLinkAvatarRoom(payload);
  }

  @GrpcMethod('ChatService', 'ChangeName')
  async ChangeName(@Body() payload: ChangeNameRoomDto) {
    return this.roomsService.changeNameRoom(payload);
  }

  @GrpcMethod('ChatService', 'ChangeNickName')
  async ChangeNickName(@Body() payload: ChangeNickNameMemberDto) {
    return this.roomsService.changeNickNameMember(payload);
  }
}
