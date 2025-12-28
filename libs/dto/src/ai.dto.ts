import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
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

export class QuizzDto {
  @ValidateIf((object, value) => object.type === 'document')
  @ValidateNested()
  @Type(() => FileUploadData)
  file: FileUploadData;

  @ValidateIf((object, value) => object.type === 'text')
  @IsNotEmpty({ message: 'Nội dung không để bỏ trống' })
  text: string;

  @IsNotEmpty({ message: 'Loại nội dung không để trống' })
  @IsIn(['text', 'document'])
  type: 'text' | 'document';

  @IsNotEmpty({ message: 'Loại câu hỏi không để trống' })
  @IsIn(['single_choice', 'multiple_choice', 'true_false', 'text'])
  question_type: 'single_choice' | 'multiple_choice' | 'true_false' | 'text';

  @IsNotEmpty({ message: 'Số lượng câu hỏi không để trống' })
  @IsNumber({}, { message: 'Số lượng câu hỏi phải là số' })
  @Min(1, { message: 'Số lượng câu hỏi phải lớn hơn 0' })
  question_max: number;

  @IsNotEmpty({ message: 'Tổng điểm số không để trống' })
  @IsNumber({}, { message: 'Tổng điểm số phải là số' })
  @Min(1, { message: 'Tổng điểm số phải lớn hơn 0' })
  question_max_points: number;
}
