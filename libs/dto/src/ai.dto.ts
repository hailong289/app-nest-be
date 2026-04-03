import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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

export class GenerateFlashcardDto {
  /** File đính kèm — bắt buộc khi type = 'document' */
  @ValidateIf((o) => o.type === 'document')
  @ValidateNested()
  @Type(() => FileUploadData)
  file?: FileUploadData;

  /** Nội dung văn bản để tạo flashcard — bắt buộc khi type = 'text' */
  @ValidateIf((o) => o.type === 'text')
  @IsNotEmpty({ message: 'Chủ đề / nội dung không để trống' })
  @IsString({ message: 'Chủ đề phải là chuỗi' })
  topic: string;

  /** Nguồn dữ liệu đầu vào */
  @IsNotEmpty({ message: 'Loại không để trống' })
  @IsIn(['text', 'document'], { message: 'Loại phải là text hoặc document' })
  type: 'text' | 'document';

  /** Số lượng flashcard cần tạo (mặc định: 10) */
  @IsOptional()
  @IsNumber({}, { message: 'Số lượng thẻ phải là số' })
  @Min(1, { message: 'Số lượng thẻ phải ≥ 1' })
  @Max(50, { message: 'Số lượng thẻ tối đa là 50' })
  card_count?: number;

  /** Độ khó 1–5 (mặc định: 3) */
  @IsOptional()
  @IsNumber({}, { message: 'Độ khó phải là số' })
  @Min(1, { message: 'Độ khó tối thiểu là 1' })
  @Max(5, { message: 'Độ khó tối đa là 5' })
  difficulty?: number;

  /** Ngôn ngữ đầu ra, ví dụ: 'vi', 'en' (mặc định: 'vi') */
  @IsOptional()
  @IsString({ message: 'Ngôn ngữ phải là chuỗi' })
  language?: string;
}
