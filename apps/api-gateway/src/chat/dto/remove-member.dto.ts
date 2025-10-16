import { IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

export class removeMeberRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @MinLength(1, { each: true })
  @IsNotEmpty()
  memberIds: string[];
}
