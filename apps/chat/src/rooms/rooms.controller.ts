import { Controller, Body } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { GrpcMethod } from '@nestjs/microservices';
import { LeavingRoomDto } from './dto/leaving-room.dto';
import { removeMeberRoomDto } from './dto/remove-member.dto';

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
  async removeMbr(@Body() payload: removeMeberRoomDto) {
    return this.roomsService.removeMemberByAdmin(payload);
  }
}
