import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  type: 'private' | 'group' | 'channel';

  @IsString({ each: true })
  @MinLength(1, { each: true })
  memberIds: string[];
}
