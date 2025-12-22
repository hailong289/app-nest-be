import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MaxLength } from 'class-validator';

interface Answer {
  answer_text: string;
  is_correct: boolean;
  points: number;
}

interface Question {
  question_text: string;
  question_type: string;
  answers: Answer[];
  points: number;
  order: number;
  explanation: string;
  image_url: string;
}

export class CreateQuizzDto {
  @IsNotEmpty({ message: 'Tiêu đề không để trống' })
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  @MaxLength(255, { message: 'Tiêu đề không được vượt quá 255 ký tự' })
  quiz_title: string;
  @IsNotEmpty({ message: 'Mô tả không để trống' })
  @IsString({ message: 'Mô tả phải là chuỗi' })
  @MaxLength(255, { message: 'Mô tả không được vượt quá 255 ký tự' })
  quiz_description: string;
  @IsNotEmpty({ message: 'Câu hỏi không để trống' })
  @IsArray({ message: 'Câu hỏi phải là mảng' })
  @ValidateNested({ each: true })
  quiz_questions: Question[];
}

export class GetQuizzDto {
  @IsNotEmpty({ message: 'ID quiz không để trống' })
  @IsString({ message: 'ID quiz phải là chuỗi' })
  quiz_id: string;
}

export class ListQuizzesDto {
  @IsNotEmpty({ message: 'Trang không để trống' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Trang phải là số' },
  )
  page: number = 1;
  @IsNotEmpty({ message: 'Số lượng không để trống' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'Số lượng phải là số' },
  )
  limit: number;
}

export class UpdateQuizzDto {
  @IsOptional()
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  @MaxLength(255, { message: 'Tiêu đề không được vượt quá 255 ký tự' })
  quiz_title?: string;
  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  @MaxLength(255, { message: 'Mô tả không được vượt quá 255 ký tự' })
  quiz_description?: string;
}

export class DeleteQuizzDto {
  @IsNotEmpty({ message: 'ID quiz không để trống' })
  @IsString({ message: 'ID quiz phải là chuỗi' })
  quiz_id: string;
}
