import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsUrl,
  Min,
} from 'class-validator';
import { MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  QuestionType,
  QuizStatus,
} from 'libs/db/src/mongo/model/quiz.model';

class AnswerDto {
  @IsNotEmpty({ message: 'Nội dung đáp án không để trống' })
  @IsString({ message: 'Nội dung đáp án phải là chuỗi' })
  answer_text: string;

  @IsNotEmpty({ message: 'Trạng thái đúng/sai không để trống' })
  @IsBoolean({ message: 'Trạng thái đúng/sai phải là boolean' })
  is_correct: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Điểm số phải là số' })
  @Min(0, { message: 'Điểm số không được âm' })
  points?: number;
}

class QuestionDto {
  @IsNotEmpty({ message: 'Nội dung câu hỏi không để trống' })
  @IsString({ message: 'Nội dung câu hỏi phải là chuỗi' })
  question_text: string;

  @IsNotEmpty({ message: 'Loại câu hỏi không để trống' })
  @IsEnum(['single_choice', 'multiple_choice', 'true_false', 'text'], {
    message: 'Loại câu hỏi không hợp lệ',
  })
  question_type: QuestionType;

  @IsNotEmpty({ message: 'Danh sách đáp án không để trống' })
  @IsArray({ message: 'Danh sách đáp án phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];

  @IsOptional()
  @IsNumber({}, { message: 'Điểm số phải là số' })
  @Min(0, { message: 'Điểm số không được âm' })
  points?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Thứ tự phải là số' })
  @Min(0, { message: 'Thứ tự không được âm' })
  order?: number;

  @IsOptional()
  @IsString({ message: 'Giải thích phải là chuỗi' })
  explanation?: string;

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  image_url?: string;
}

export class CreateQuizzDto {
  @IsNotEmpty({ message: 'Tiêu đề không để trống' })
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  @MaxLength(255, { message: 'Tiêu đề không được vượt quá 255 ký tự' })
  quiz_title: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  quiz_description?: string;

  @IsNotEmpty({ message: 'ID phòng không để trống' })
  @IsString({ message: 'ID phòng phải là chuỗi' })
  quiz_roomId: string;

  @IsNotEmpty({ message: 'ID người tạo không để trống' })
  @IsString({ message: 'ID người tạo phải là chuỗi' })
  quiz_createdBy: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'completed', 'cancelled'], {
    message: 'Trạng thái không hợp lệ',
  })
  quiz_status?: QuizStatus;

  @IsOptional()
  @IsNumber({}, { message: 'Thời gian làm bài phải là số' })
  @Min(0, { message: 'Thời gian làm bài không được âm' })
  quiz_timeLimit?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian bắt đầu không hợp lệ' })
  quiz_startTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian kết thúc không hợp lệ' })
  quiz_endTime?: string;

  @IsOptional()
  @IsBoolean({ message: 'Hiển thị kết quả phải là boolean' })
  quiz_showResults?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Cho phép làm lại phải là boolean' })
  quiz_allowRetake?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Số lần làm tối đa phải là số' })
  @Min(0, { message: 'Số lần làm tối đa không được âm' })
  quiz_maxAttempts?: number;

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  quiz_image?: string;

  @IsNotEmpty({ message: 'Câu hỏi không để trống' })
  @IsArray({ message: 'Câu hỏi phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  quiz_questions: QuestionDto[];
}

export class GetQuizzDto {
  @IsNotEmpty({ message: 'ID quiz không để trống' })
  @IsString({ message: 'ID quiz phải là chuỗi' })
  quiz_id: string;
}

export class ListQuizzesDto {
  @IsNotEmpty({ message: 'ID phòng không để trống' })
  @IsString({ message: 'ID phòng phải là chuỗi' })
  roomId: string;
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
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  quiz_description?: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'completed', 'cancelled'], {
    message: 'Trạng thái không hợp lệ',
  })
  quiz_status?: QuizStatus;

  @IsOptional()
  @IsNumber({}, { message: 'Thời gian làm bài phải là số' })
  @Min(0, { message: 'Thời gian làm bài không được âm' })
  quiz_timeLimit?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian bắt đầu không hợp lệ' })
  quiz_startTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian kết thúc không hợp lệ' })
  quiz_endTime?: string;

  @IsOptional()
  @IsBoolean({ message: 'Hiển thị kết quả phải là boolean' })
  quiz_showResults?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Cho phép làm lại phải là boolean' })
  quiz_allowRetake?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Số lần làm tối đa phải là số' })
  @Min(0, { message: 'Số lần làm tối đa không được âm' })
  quiz_maxAttempts?: number;

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsUrl({}, { message: 'URL ảnh không hợp lệ' })
  quiz_image?: string;

  @IsOptional()
  @IsArray({ message: 'Câu hỏi phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  quiz_questions?: QuestionDto[];
}

export class DeleteQuizzDto {
  @IsNotEmpty({ message: 'ID quiz không để trống' })
  @IsString({ message: 'ID quiz phải là chuỗi' })
  quiz_id: string;
}
