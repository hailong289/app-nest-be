import { IsNotEmpty, IsOptional } from 'class-validator';

export class ModerationDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;
  @IsOptional()
  userId: string;
}
