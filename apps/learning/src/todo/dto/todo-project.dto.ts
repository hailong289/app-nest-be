import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTodoProjectDto {
  @IsNotEmpty({ message: 'Tên project không để trống' })
  @IsString({ message: 'Tên project phải là chuỗi' })
  project_name: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  project_description?: string;

  @IsOptional()
  @IsString({ message: 'Màu project phải là chuỗi' })
  project_color?: string;

  @IsNotEmpty({ message: 'ID người tạo không để trống' })
  @IsString({ message: 'ID người tạo phải là chuỗi' })
  project_createdBy: string;

  @IsOptional()
  @IsString({ message: 'ID phòng phải là chuỗi' })
  project_roomId?: string;

  @IsOptional()
  @IsBoolean({ message: 'is_default phải là boolean' })
  is_default?: boolean;
}

export class GetTodoProjectDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsOptional()
  @IsString({ message: 'userId phải là chuỗi' })
  userId?: string;
}

export class ListTodoProjectsDto {
  @IsNotEmpty({ message: 'userId không để trống' })
  @IsString({ message: 'userId phải là chuỗi' })
  userId: string;

  @IsOptional()
  @IsString({ message: 'roomId phải là chuỗi' })
  roomId?: string;

  @IsNotEmpty({ message: 'Trang không để trống' })
  @IsInt({ message: 'Trang phải là số nguyên' })
  @Min(1)
  page: number;

  @IsNotEmpty({ message: 'Số lượng không để trống' })
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1)
  limit: number;
}

export class UpdateTodoProjectDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsOptional()
  @IsString({ message: 'Tên project phải là chuỗi' })
  project_name?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  project_description?: string;

  @IsOptional()
  @IsString({ message: 'Màu project phải là chuỗi' })
  project_color?: string;
}

export class DeleteTodoProjectDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;
}

export class AddProjectStatusDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsNotEmpty({ message: 'Tên trạng thái không để trống' })
  @IsString({ message: 'Tên trạng thái phải là chuỗi' })
  status_name: string;

  @IsOptional()
  @IsString({ message: 'Màu trạng thái phải là chuỗi' })
  status_color?: string;
}

export class UpdateProjectStatusDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsNotEmpty({ message: 'ID trạng thái không để trống' })
  @IsString({ message: 'ID trạng thái phải là chuỗi' })
  status_id: string;

  @IsOptional()
  @IsString({ message: 'Tên trạng thái phải là chuỗi' })
  status_name?: string;

  @IsOptional()
  @IsString({ message: 'Màu trạng thái phải là chuỗi' })
  status_color?: string;

  @IsOptional()
  @IsInt({ message: 'Thứ tự phải là số nguyên' })
  @Min(1)
  status_order?: number;
}

export class DeleteProjectStatusDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsNotEmpty({ message: 'ID trạng thái không để trống' })
  @IsString({ message: 'ID trạng thái phải là chuỗi' })
  status_id: string;
}

export class GetOrCreateDefaultProjectDto {
  @IsNotEmpty({ message: 'userId không để trống' })
  @IsString({ message: 'userId phải là chuỗi' })
  userId: string;

  @IsOptional()
  @IsString({ message: 'roomId phải là chuỗi' })
  roomId?: string;
}

export class AddProjectMemberDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsNotEmpty({ message: 'ID member không để trống' })
  @IsString({ message: 'ID member phải là chuỗi' })
  member_id: string;
}

export class RemoveProjectMemberDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsNotEmpty({ message: 'ID member không để trống' })
  @IsString({ message: 'ID member phải là chuỗi' })
  member_id: string;
}

export class GetProjectMembersDto {
  @IsNotEmpty({ message: 'ID project không để trống' })
  @IsString({ message: 'ID project phải là chuỗi' })
  project_id: string;

  @IsOptional()
  @IsString({ message: 'search phải là chuỗi' })
  search?: string;
}
