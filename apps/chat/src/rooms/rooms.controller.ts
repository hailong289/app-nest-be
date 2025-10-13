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

  @Post()
  @GrpcMethod('ChatService', 'CreateRoom')
  create(@Body() createRoomDto: CreateRoomDto) {
    console.log(
      '🚀 ~ RoomsController ~ create ~ createRoomDto:',
      createRoomDto,
    );
    const rl = this.roomsService.create(createRoomDto);
    console.log('🚀 ~ RoomsController ~ create ~ rl:', rl);
    return rl;
  }
}
