import { Injectable } from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  create(CreateRoomDto: CreateRoomDto) {
    return 'This action adds a new room';
  }
}
