import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import type { TodoPriority, TodoStatus } from 'libs/db/src/mongo/model/todo.model';

export class CreateTodoDto {
  @IsNotEmpty({ message: 'Tiêu đề không để trống' })
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  todo_title: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  todo_description?: string;

  @IsOptional()
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  todo_status?: TodoStatus;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high'], { message: 'Độ ưu tiên không hợp lệ' })
  todo_priority?: TodoPriority;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày hết hạn không hợp lệ' })
  todo_dueDate?: string;

  @IsOptional()
  @IsString({ message: 'ID phòng phải là chuỗi' })
  todo_roomId?: string;

  @IsNotEmpty({ message: 'ID người tạo không để trống' })
  @IsString({ message: 'ID người tạo phải là chuỗi' })
  todo_createdBy: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách assignees phải là mảng' })
  @IsString({ each: true, message: 'Mỗi assignee ID phải là chuỗi' })
  todo_assignees?: string[];
}

export class GetTodoDto {
  @IsNotEmpty({ message: 'ID todo không để trống' })
  @IsString({ message: 'ID todo phải là chuỗi' })
  todo_id: string;
}

export class ListTodosDto {
  @IsNotEmpty({ message: 'userId không để trống' })
  @IsString({ message: 'userId phải là chuỗi' })
  userId: string;

  @IsOptional()
  @IsString({ message: 'roomId phải là chuỗi' })
  roomId?: string;

  @IsOptional()
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  status?: TodoStatus;

  @IsNotEmpty({ message: 'Trang không để trống' })
  @IsNumber({}, { message: 'Trang phải là số' })
  @Min(1)
  page: number;

  @IsNotEmpty({ message: 'Số lượng không để trống' })
  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(1)
  limit: number;
}

export class UpdateTodoDto {
  @IsOptional()
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  todo_title?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  todo_description?: string;

  @IsOptional()
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  todo_status?: TodoStatus;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high'], { message: 'Độ ưu tiên không hợp lệ' })
  todo_priority?: TodoPriority;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày hết hạn không hợp lệ' })
  todo_dueDate?: string;
}

export class DeleteTodoDto {
  @IsNotEmpty({ message: 'ID todo không để trống' })
  @IsString({ message: 'ID todo phải là chuỗi' })
  todo_id: string;
}

export class AssignTodoDto {
  @IsNotEmpty({ message: 'ID todo không để trống' })
  @IsString({ message: 'ID todo phải là chuỗi' })
  todo_id: string;

  @IsArray({ message: 'Danh sách assignees phải là mảng' })
  @IsString({ each: true, message: 'Mỗi assignee ID phải là chuỗi' })
  assignee_ids: string[];
}

export class UpdateTodoStatusDto {
  @IsNotEmpty({ message: 'ID todo không để trống' })
  @IsString({ message: 'ID todo phải là chuỗi' })
  todo_id: string;

  @IsNotEmpty({ message: 'Trạng thái không để trống' })
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  status: TodoStatus;
}
