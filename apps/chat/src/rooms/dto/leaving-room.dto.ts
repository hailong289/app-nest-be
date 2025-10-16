import { IsString, IsOptional } from 'class-validator';

export class LeavingRoomDto {
  @IsOptional()
  @IsString()
  userId: string;

  @IsString()
  roomId: string;
}
