import { Injectable } from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { Response } from '@app/helpers/response';

@Injectable()
export class RoomsService {
  create(payload: CreateRoomDto) {
    console.log('🚀 ~ RoomsService ~ create ~ payload:', payload);
    return Response.success(
      {
        type: payload.type,
      },
      'Tạo phòng thành công',
    );
  }
}
