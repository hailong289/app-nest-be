import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { GrpcMethod } from '@nestjs/microservices';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  // @Post()
  @GrpcMethod('ChatService', 'CreateRoom')
  async create(@Body() createRoomDto: CreateRoomDto) {
    const rl = await this.roomsService.create(createRoomDto);
    console.log('🚀 ~ RoomsController ~ create ~ rl:', rl);

    return rl;
  }
}
