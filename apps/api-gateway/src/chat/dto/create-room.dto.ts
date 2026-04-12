import { IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  avatar: string;

  @IsString()
  @IsNotEmpty()
  type: 'private' | 'group' | 'channel';

  @IsString({ each: true })
  @MinLength(1, { each: true })
  @IsNotEmpty()
  memberIds: string[];
}
