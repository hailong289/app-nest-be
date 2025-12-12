import { IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { FileUploadData } from './filesystem.dto';
import { Type } from 'class-transformer';

export class ModerationDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;
  @IsOptional()
  userId: string;
}

export class SearchMessagesDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;

  @IsNotEmpty({ message: 'Phòng chat không để trống' })
  roomId: string;

  @IsOptional()
  limit: number = 5;
}

export class SummaryDocumentDto {
  @ValidateNested()
  @Type(() => FileUploadData)
  file: FileUploadData;
}

export class TranslationDto {
  @IsNotEmpty({ message: 'Nội dung không để trống' })
  text: string;
  @IsNotEmpty({ message: 'Ngôn ngữ nguồn không để trống' })
  from: string;
  @IsNotEmpty({ message: 'Ngôn ngữ đích không để trống' })
  to: string;
}
