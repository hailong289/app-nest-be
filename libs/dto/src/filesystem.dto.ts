import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { File } from 'node:buffer';
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export class FileUploadData {
  @IsNotEmpty({ message: 'Buffer không được để trống' })
  buffer: Buffer;

  @IsNotEmpty({ message: 'Tên file không được để trống' })
  @IsString()
  originalname: string;

  @IsNotEmpty({ message: 'Mimetype không được để trống' })
  @IsString()
  mimetype: string;
}

export class SingleFileUploadDto {
  @ValidateNested()
  @Type(() => FileUploadData)
  file: FileUploadData;

  @IsOptional()
  @IsString()
  folder: string;
}

export class MultipleFilesUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileUploadData)
  files: FileUploadData[];

  @IsOptional()
  @IsString()
  folder: string;
}

export class uploadSingleFileByUserDTo {
  id?: string;
  userId: string;
  file: MulterFile;
  roomId: string;
  messageId?: string;
}

export class UploadMultipleFilesByUserDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileUploadData)
  files: FileUploadData[];

  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  roomId: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

export class GetAttachmentsDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class UploadSingleFileForUserDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileUploadData)
  files: FileUploadData[];

  @IsOptional()
  @IsString()
  roomId: string;
}
