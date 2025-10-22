import {
  DeleteObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { File as MulterFile } from 'multer';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Response } from '@app/helpers/response';

@Injectable()
export class FilesystemService {
  private s3: S3Client;

  constructor(private configService: ConfigService) {
    try {
      this.s3 = new S3Client({
        region: this.configService.get<string>('s3.region') ?? 'us-east-1',
        endpoint: this.configService.get<string>('s3.endpoint'),
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.configService.get<string>('s3.accessKeyId') ?? '',
          secretAccessKey:
            this.configService.get<string>('s3.secretAccessKey') ?? '',
        },
      });
      console.log('🔥 S3 Client initialized');
    } catch (error) {
      console.error('❌ S3 Client initialization error:', error);
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/-+/g, '_') // Replace multiple hyphens with single
      .trim(); // Remove leading/trailing spaces
  }

  async uploadSingleFile(file: MulterFile, folder: string = 'uploads') {
    const timestamp = new Date().getTime();
    const fileExtension = file.originalname.split('.').pop();
    const fileNameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    const sluggedFileName = this.slugify(fileNameWithoutExt);
    const fileName = `${sluggedFileName}_${timestamp}.${fileExtension}`;
    const uploadParams = {
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: `${folder}/${fileName}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: ObjectCannedACL.public_read,
    };
    try {
      await this.s3.send(new PutObjectCommand(uploadParams));
      return Response.success(
        {
          url: `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${folder}/${fileName}`,
        },
        'Tải hình ảnh thành công',
      );
    } catch (error) {
      return Response.success(
        {
          url: '',
          message: 'Tải ảnh thất bại ' + error.message,
        },
        'Tải ảnh thất bại',
        400,
        'ERROR_FILESYSTEM',
      );
    }
  }

  async uploadMultipleFiles(files: MulterFile[], folder: string = 'uploads') {
    if (!files || files.length === 0) {
      throw new Error('No files received');
    }

    const uploadPromises = files.map((file) =>
      this.uploadSingleFile(file, folder),
    );
    const results = await Promise.all(uploadPromises);

    return Response.success(
      {
        urls: results.map((result) => result.metadata.url),
        messages: results.map(
          (result, index) => `${result.message} ${index + 1}`,
        ),
        totalFiles: results.length,
        successfulUploads: results.filter(
          (result) => result.metadata.url !== '',
        ).length,
        failedUploads: results.filter((result) => result.metadata.url === '')
          .length,
      },
      'Tải nhiều file',
      400,
      'ERROR_FILESYSTEM',
    );
  }

  async deleteFile(fileName: string, folder: string = 'uploads') {
    const deleteParams = {
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: `${folder}/${fileName}`,
    };
    try {
      await this.s3.send(new DeleteObjectCommand(deleteParams));
      return {
        message: 'File deleted successfully',
      };
    } catch (error) {
      return {
        message: 'File deletion failed ' + error.message,
      };
    }
  }

  async getPresignedUrl(fileName: string) {
    const command = new GetObjectCommand({
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: fileName,
    });
    return {
      url: await getSignedUrl(this.s3, command, { expiresIn: 3600 }),
      message: 'Presigned URL generated successfully',
    };
  }
}
