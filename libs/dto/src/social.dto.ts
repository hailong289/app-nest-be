import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

// create  friendship

// Friend Request DTOs
export class SendFriendRequestDto {
  @IsString()
  @IsNotEmpty()
  frpUserId1: string; // sender

  @IsString()
  @IsNotEmpty()
  frpUserId2: string; // receiver

  @IsString()
  @IsNotEmpty()
  frpActionUserId: string; // user who performs the action
}

export class GetFriendRequestsDto {
  @IsString()
  @IsOptional()
  @IsEnum(['received', 'sent', 'all'])
  type?: string = 'all';
}

export class AcceptFriendRequestDto {
  @IsString()
  @IsNotEmpty()
  frp_id: string;

  @IsString()
  @IsNotEmpty()
  frp_userId1: string;

  @IsString()
  @IsNotEmpty()
  frp_userId2: string;

  @IsString()
  @IsNotEmpty()
  frp_actionUserId: string;
}

export class RejectFriendRequestDto {
  @IsString()
  @IsNotEmpty()
  frpId: string;

  @IsString()
  @IsNotEmpty()
  frpUserId1: string;

  @IsString()
  @IsNotEmpty()
  frpUserId2: string;
}

// User Search DTOs
export class SearchUsersDto {
  @IsString()
  @IsNotEmpty()
  search: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

// Friends DTOs
export class GetFriendsDto {
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsString()
  @IsOptional()
  search?: string = '';
}

export class RemoveFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId: string;

  @IsString()
  @IsNotEmpty()
  actionUserId: string;
}

export class BlockFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId: string;
  @IsString()
  @IsNotEmpty()
  actionUserId: string;
}

export class OpenBlockedFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId: string;
  @IsString()
  @IsNotEmpty()
  actionUserId: string;
}

// Response DTOs
export class FriendRequestResponseDto {
  frpId: string;
  frpUserId1: string;
  frpUserId2: string;
  frpActionUserId: string;
  frpStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED';
  created_at: number;
  user1?: UserInfoDto;
  user2?: UserInfoDto;
  action_user?: UserInfoDto;
}

export class UserInfoDto {
  user_id: string;
  name: string;
  avatar: string;
  is_online?: boolean;
  last_seen?: number;
}

export class UserSearchResultDto {
  user_id: string;
  name: string;
  avatar: string;
  mutual_friends: number;
  is_friend: boolean;
  has_request: boolean;
  request_status: 'pending' | 'sent' | 'none';
}

export class FriendDto {
  user_id: string;
  name: string;
  avatar: string;
  is_online: boolean;
  last_seen: number;
  friendship_created_at: number;
}

// Common Response DTOs
export class PaginationDto {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export class GetFriendRequestsResponseDto {
  success: boolean;
  message: string;
  received: FriendRequestResponseDto[];
  sent: FriendRequestResponseDto[];
}

export class SearchUsersResponseDto {
  success: boolean;
  message: string;
  users: UserSearchResultDto[];
  total: number;
  page: number;
  limit: number;
}

export class GetFriendsResponseDto {
  success: boolean;
  message: string;
  friends: FriendDto[];
  total: number;
  page: number;
  limit: number;
}

export class SendFriendRequestResponseDto {
  success: boolean;
  message: string;
  frp_id: string;
  frp_status: string;
  created_at: number;
}

export class AcceptFriendRequestResponseDto {
  success: boolean;
  message: string;
  frp_id: string;
  frp_status: string;
  accepted_at: number;
}

export class RejectFriendRequestResponseDto {
  success: boolean;
  message: string;
  frp_id: string;
  frp_status: string;
  rejected_at: number;
}

export class RemoveFriendResponseDto {
  success: boolean;
  message: string;
  frp_id: string;
  frp_status: string;
  removed_at: number;
}
