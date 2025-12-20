import {
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  IsNumber,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Types } from 'mongoose';
import { EventRoomType } from 'libs/db/src/mongo/model/room-events.model';
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
export class LeavingRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  roomId: string;
}
export class RemoveMemberRoomDto {
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

export class AddMemberRoomDto {
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
type roomType = 'all' | 'group' | 'channel' | 'private';
export class OptionsType {
  @IsOptional()
  @IsString()
  q: string = '';

  @IsOptional()
  @Type(() => Number) // chuyển string -> number khi query params
  @IsNumber()
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  offset: number = 0;

  @IsOptional()
  @IsIn(['all', 'private', 'group', 'channel'])
  type: roomType = 'all';
}
export class GetRoomType {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OptionsType)
  options: OptionsType = new OptionsType();
}

export class ChangelinkAvatarRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  link: string;
}

export class ChangeNameRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateRoomEvent {
  event_type: EventRoomType;
  room_id: Types.ObjectId;
  actor_id: Types.ObjectId;
  placeholder: string;
  targets: Types.ObjectId[];
  message_id?: Types.ObjectId;
  payload?: Record<string, any>;
}

export class GetRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;
}

export class ChangeNickNameMemberDto {
  @IsString()
  userId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class ChangeRoleMemberDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsString()
  @IsNotEmpty()
  role: string;
}

export class PinnedRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsOptional()
  pinned: boolean;
}

export class MutedRoomDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsOptional()
  muted: boolean;
}
