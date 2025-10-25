import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
