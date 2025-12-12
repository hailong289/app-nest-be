import { IsNotEmpty, IsOptional } from 'class-validator';

export class ModerationDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;
  @IsOptional()
  userId: string;
}

export class SearchMessagesDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;

  @IsOptional()
  userId: string;

  @IsNotEmpty({ message: 'Phòng chat không để trống' })
  roomId: string;

  @IsOptional()
  limit: number = 5;
}
