import {
  DeleteObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Attachment, AttachmentKind, Room, User } from 'libs/db/src';
import { Model } from 'mongoose';
import Utils from '@app/helpers/utils';
import { MulterFile, uploadSingleFileByUserDTo } from '@app/dto';

@Injectable()
export class FilesystemService {
  private s3: S3Client;
  private readonly utils = Utils;
  constructor(
    private configService: ConfigService,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Attachment')
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel('Room') private readonly roomModel: Model<Room>,
  ) {
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
    const fileExtension =
      file &&
      typeof file === 'object' &&
      typeof file.originalname === 'string' &&
      file.originalname.includes('.')
        ? (file.originalname.split('.').pop() ?? '')
        : '';
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.originalname !== 'string'
    ) {
      throw new Error('Invalid file object');
    }
    const fileNameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    const sluggedFileName = this.slugify(fileNameWithoutExt);
    const fileName = `${sluggedFileName}_${timestamp}.${fileExtension}`;
    const uploadParams = {
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: `${folder}/${fileName}`,
      Body:
        typeof file === 'object' &&
        file !== null &&
        'buffer' in file &&
        file.buffer instanceof Buffer
          ? file.buffer
          : Buffer.alloc(0),
      ContentType:
        typeof file === 'object' && file !== null && 'mimetype' in file
          ? file.mimetype
          : '',
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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return Response.success(
        {
          url: '',
          message: 'Tải ảnh thất bại ' + errorMessage,
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
    type UploadResult = {
      metadata: { url: string; message?: string };
      message: string;
    };
    const results = (await Promise.all(uploadPromises)) as UploadResult[];

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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        message: 'File deletion failed ' + errorMessage,
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

  async uploadSingleFileByUser({
    userId,
    roomId,
    file,
    id,
  }: uploadSingleFileByUserDTo) {
    if (!file || !file.buffer) {
      throw new Error('File or buffer is missing');
    }
    // check userInfo
    const findUser = await this.userModel.findById(userId);
    if (!findUser) {
      throw new NotFoundException('không tìm thấy user');
    }
    // get roomInfor
    const roomPair = this.utils.pairRoomId(findUser.usr_id, roomId);
    console.log(
      '🚀 ~ FilesystemService ~ uploadSingleFileByUser ~ roomPair:',
      roomPair,
    );
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, roomPair],
      },
    });

    if (!finInfo) {
      console.error('❌ Room not found:', roomId);
      throw new NotFoundException('Không tìm thấy phòng');
    }

    console.log('✅ Room found:', finInfo.room_id);

    const timestamp = Date.now();
    const fileExtension = file.originalname.split('.').pop();
    const fileNameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    const sluggedFileName = this.slugify(fileNameWithoutExt);
    const fileName = `${sluggedFileName}_${timestamp}.${fileExtension}`;
    const folder = finInfo.room_id;

    console.log('📁 Upload details:', {
      folder,
      fileName,
      fileExtension,
    });

    const uploadParams = {
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: `${folder}/${fileName}`,
      Body:
        typeof file === 'object' &&
        file !== null &&
        'buffer' in file &&
        file.buffer instanceof Buffer
          ? file.buffer
          : Buffer.alloc(0),
      ContentType:
        typeof file === 'object' && file !== null && 'mimetype' in file
          ? file.mimetype
          : '',
      ACL: ObjectCannedACL.public_read,
    };

    console.log('☁️ Uploading to S3...');
    // Upload to S3
    const fileUrl = `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${folder}/${fileName}`;

    // Determine file kind based on mimetype
    let kind: AttachmentKind = 'file';
    if (file && typeof file.mimetype === 'string') {
      if (file.mimetype.startsWith('image/')) {
        kind = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        kind = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        kind = 'audio';
      }
    }

    const attachmentData = {
      kind,
      url: fileUrl,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      user_id: this.utils.convertToObjectIdMongoose(userId),
      room_id: finInfo._id,
      status: 'processing' as const, // Bắt đầu với status processing
    };

    // 1️⃣ Tạo hoặc update attachment record TRƯỚC KHI upload S3
    let attachment: Attachment;
    try {
      if (id) {
        const updated = await this.attachmentModel.findOneAndUpdate(
          { _id: id },
          attachmentData,
          { upsert: true, new: true },
        );
        if (!updated) {
          throw new BadRequestException(
            'Không thể lưu attachment vào database',
          );
        }
        attachment = updated;
      } else {
        attachment = await this.attachmentModel.create(attachmentData);
      }
      console.log('✅ Attachment record created:', (attachment as any)._id);
    } catch (dbError) {
      console.error('❌ Database error:', dbError);
      const errorMessage =
        dbError instanceof Error ? dbError.message : 'Unknown error';
      return Response.error(
        'Không thể tạo record trong database: ' + errorMessage,
        400,
        'ERROR_FILESYSTEM',
        dbError,
      );
    }

    // 2️⃣ Upload lên S3
    try {
      await this.s3.send(new PutObjectCommand(uploadParams));
      console.log('✅ S3 upload successful');

      // 3️⃣ Update status thành công
      await this.attachmentModel.findByIdAndUpdate((attachment as any)._id, {
        status: 'uploaded',
      });

      return Response.success(
        {
          _id: (attachment as any)?._id?.toString() ?? '',
          url: fileUrl,
          kind,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          status: 'uploaded',
        },
        'Tải file thành công',
      );
    } catch (s3Error) {
      console.error('❌ S3 upload error:', s3Error);

      // 4️⃣ Update status thất bại
      await this.attachmentModel.findByIdAndUpdate((attachment as any)._id, {
        status: 'failed',
      });

      const errorMessage =
        s3Error instanceof Error ? s3Error.message : 'Unknown error';
      return Response.error(
        'Tải file lên S3 thất bại: ' + errorMessage,
        400,
        'ERROR_FILESYSTEM',
        s3Error,
      );
    }
  }
}
