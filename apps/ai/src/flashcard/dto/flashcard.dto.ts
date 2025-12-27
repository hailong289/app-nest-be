import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  Max,
} from 'class-validator';
import { MaxLength } from 'class-validator';

class FlashcardProgressDto {
  @IsNotEmpty({ message: 'ID người dùng không để trống' })
  @IsString({ message: 'ID người dùng phải là chuỗi' })
  user_id: string;

  @IsOptional()
  @IsNumber({}, { message: 'Mức độ thành thạo phải là số' })
  @Min(0, { message: 'Mức độ thành thạo không được âm' })
  @Max(100, { message: 'Mức độ thành thạo không được vượt quá 100' })
  mastery_level?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lần ôn tập phải là số' })
  @Min(0, { message: 'Số lần ôn tập không được âm' })
  review_count?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lần trả lời đúng phải là số' })
  @Min(0, { message: 'Số lần trả lời đúng không được âm' })
  correct_count?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lần trả lời sai phải là số' })
  @Min(0, { message: 'Số lần trả lời sai không được âm' })
  incorrect_count?: number;

  @IsOptional()
  @IsBoolean({ message: 'Đã thành thạo phải là boolean' })
  is_mastered?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Đã đánh dấu yêu thích phải là boolean' })
  is_favorite?: boolean;

  @IsOptional()
  @IsEnum(['new', 'learning', 'review', 'mastered'], {
    message: 'Trạng thái không hợp lệ',
  })
  status?: string;
}

export class CreateFlashcardDto {
  @IsNotEmpty({ message: 'ID người dùng không để trống' })
  @IsString({ message: 'ID người dùng phải là chuỗi' })
  card_userId: string;

  @IsOptional()
  @IsString({ message: 'ID bộ thẻ phải là chuỗi' })
  card_deckId?: string;

  @IsNotEmpty({ message: 'Mặt trước không để trống' })
  @IsString({ message: 'Mặt trước phải là chuỗi' })
  @MaxLength(1000, { message: 'Mặt trước không được vượt quá 1000 ký tự' })
  card_front: string;

  @IsNotEmpty({ message: 'Mặt sau không để trống' })
  @IsString({ message: 'Mặt sau phải là chuỗi' })
  @MaxLength(2000, { message: 'Mặt sau không được vượt quá 2000 ký tự' })
  card_back: string;

  @IsOptional()
  @IsString({ message: 'Gợi ý phải là chuỗi' })
  @MaxLength(500, { message: 'Gợi ý không được vượt quá 500 ký tự' })
  card_hint?: string;

  @IsOptional()
  @IsArray({ message: 'Tags phải là mảng' })
  @IsString({ each: true, message: 'Mỗi tag phải là chuỗi' })
  card_tags?: string[];

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsUrl({}, { message: 'URL ảnh không hợp lệ' })
  card_image?: string;

  @IsOptional()
  @IsString({ message: 'URL âm thanh phải là chuỗi' })
  @IsUrl({}, { message: 'URL âm thanh không hợp lệ' })
  card_audio?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Độ khó phải là số' })
  @Min(1, { message: 'Độ khó tối thiểu là 1' })
  @Max(5, { message: 'Độ khó tối đa là 5' })
  card_difficulty?: number;

  @IsOptional()
  @IsBoolean({ message: 'Công khai phải là boolean' })
  card_isPublic?: boolean;
}

export class UpdateFlashcardDto {
  @IsOptional()
  @IsString({ message: 'ID bộ thẻ phải là chuỗi' })
  card_deckId?: string;

  @IsOptional()
  @IsString({ message: 'Mặt trước phải là chuỗi' })
  @MaxLength(1000, { message: 'Mặt trước không được vượt quá 1000 ký tự' })
  card_front?: string;

  @IsOptional()
  @IsString({ message: 'Mặt sau phải là chuỗi' })
  @MaxLength(2000, { message: 'Mặt sau không được vượt quá 2000 ký tự' })
  card_back?: string;

  @IsOptional()
  @IsString({ message: 'Gợi ý phải là chuỗi' })
  @MaxLength(500, { message: 'Gợi ý không được vượt quá 500 ký tự' })
  card_hint?: string;

  @IsOptional()
  @IsArray({ message: 'Tags phải là mảng' })
  @IsString({ each: true, message: 'Mỗi tag phải là chuỗi' })
  card_tags?: string[];

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsUrl({}, { message: 'URL ảnh không hợp lệ' })
  card_image?: string;

  @IsOptional()
  @IsString({ message: 'URL âm thanh phải là chuỗi' })
  @IsUrl({}, { message: 'URL âm thanh không hợp lệ' })
  card_audio?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Độ khó phải là số' })
  @Min(1, { message: 'Độ khó tối thiểu là 1' })
  @Max(5, { message: 'Độ khó tối đa là 5' })
  card_difficulty?: number;

  @IsOptional()
  @IsBoolean({ message: 'Công khai phải là boolean' })
  card_isPublic?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Đã lưu trữ phải là boolean' })
  card_isArchived?: boolean;
}

export class GetFlashcardDto {
  @IsNotEmpty({ message: 'ID flashcard không để trống' })
  @IsString({ message: 'ID flashcard phải là chuỗi' })
  card_id: string;
}

export class ListFlashcardsDto {
  @IsOptional()
  @IsString({ message: 'ID người dùng phải là chuỗi' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'ID bộ thẻ phải là chuỗi' })
  deckId?: string;

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

export class DeleteFlashcardDto {
  @IsNotEmpty({ message: 'ID flashcard không để trống' })
  @IsString({ message: 'ID flashcard phải là chuỗi' })
  card_id: string;
}

// Flashcard Deck DTOs
export class CreateFlashcardDeckDto {
  @IsNotEmpty({ message: 'ID người dùng không để trống' })
  @IsString({ message: 'ID người dùng phải là chuỗi' })
  deck_userId: string;

  @IsNotEmpty({ message: 'Tên bộ thẻ không để trống' })
  @IsString({ message: 'Tên bộ thẻ phải là chuỗi' })
  @MaxLength(255, { message: 'Tên bộ thẻ không được vượt quá 255 ký tự' })
  deck_name: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  deck_description?: string;

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsUrl({}, { message: 'URL ảnh không hợp lệ' })
  deck_image?: string;

  @IsOptional()
  @IsArray({ message: 'Tags phải là mảng' })
  @IsString({ each: true, message: 'Mỗi tag phải là chuỗi' })
  deck_tags?: string[];

  @IsOptional()
  @IsBoolean({ message: 'Công khai phải là boolean' })
  deck_isPublic?: boolean;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'], {
    message: 'Mức độ không hợp lệ',
  })
  deck_level?: string;

  @IsOptional()
  @IsString({ message: 'Ngôn ngữ phải là chuỗi' })
  deck_language?: string;
}

export class UpdateFlashcardDeckDto {
  @IsOptional()
  @IsString({ message: 'Tên bộ thẻ phải là chuỗi' })
  @MaxLength(255, { message: 'Tên bộ thẻ không được vượt quá 255 ký tự' })
  deck_name?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  deck_description?: string;

  @IsOptional()
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsUrl({}, { message: 'URL ảnh không hợp lệ' })
  deck_image?: string;

  @IsOptional()
  @IsArray({ message: 'Tags phải là mảng' })
  @IsString({ each: true, message: 'Mỗi tag phải là chuỗi' })
  deck_tags?: string[];

  @IsOptional()
  @IsBoolean({ message: 'Công khai phải là boolean' })
  deck_isPublic?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Đã lưu trữ phải là boolean' })
  deck_isArchived?: boolean;

  @IsOptional()
  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'], {
    message: 'Mức độ không hợp lệ',
  })
  deck_level?: string;

  @IsOptional()
  @IsString({ message: 'Ngôn ngữ phải là chuỗi' })
  deck_language?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách ID thẻ phải là mảng' })
  @IsString({ each: true, message: 'Mỗi ID thẻ phải là chuỗi' })
  deck_cardIds?: string[];
}

export class GetFlashcardDeckDto {
  @IsNotEmpty({ message: 'ID bộ thẻ không để trống' })
  @IsString({ message: 'ID bộ thẻ phải là chuỗi' })
  deck_id: string;
}

export class ListFlashcardDecksDto {
  @IsOptional()
  @IsString({ message: 'ID người dùng phải là chuỗi' })
  userId?: string;

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

export class DeleteFlashcardDeckDto {
  @IsNotEmpty({ message: 'ID bộ thẻ không để trống' })
  @IsString({ message: 'ID bộ thẻ phải là chuỗi' })
  deck_id: string;
}
