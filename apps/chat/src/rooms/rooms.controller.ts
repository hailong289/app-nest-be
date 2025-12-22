import { Controller, Body } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  ChangelinkAvatarRoomDto,
  ChangeNameRoomDto,
  ChangeNickNameMemberDto,
  ChangeRoleMemberDto,
  CreateRoomDto,
  GetRoomDto,
  GetRoomType,
  LeavingRoomDto,
  MutedRoomDto,
  PinnedRoomDto,
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
    const result = this.roomsService.removeMemberByAdmin(payload);
    // console.log('🚀 ~ RoomsController ~ removeMbr ~ result:', result);
    return result;
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
  async GetRoom(@Body() payload: GetRoomDto) {
    const result = await this.roomsService.GetRoom(payload);
    // console.log('🚀 ~ RoomsController ~ GetRoom ~ result:', result.metadata);
    return result;
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

  @GrpcMethod('ChatService', 'ChangeRole')
  async ChangeRole(@Body() payload: ChangeRoleMemberDto) {
    return this.roomsService.changeRoleMember(payload);
  }

  @GrpcMethod('ChatService', 'PinnendRoom')
  async PinnendRoom(@Body() payload: PinnedRoomDto) {
    return this.roomsService.PinnendRoom(payload);
  }

  @GrpcMethod('ChatService', 'MutedRoom')
  async MutedRoom(@Body() payload: MutedRoomDto) {
    return this.roomsService.MutedRoom(payload);
  }
}
