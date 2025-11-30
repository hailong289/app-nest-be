import {
  DeleteObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Attachment, AttachmentKind, Room, User } from 'libs/db/src';
import { Model } from 'mongoose';
import Utils from '@app/helpers/utils';
import { MulterFile, uploadSingleFileByUserDTo } from '@app/dto';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import ffmpegStatic from '@ffprobe-installer/ffprobe';
import ffmpegImport from 'fluent-ffmpeg';
const ffmpeg: typeof import('fluent-ffmpeg') = ffmpegImport;
import sharp from 'sharp';
import probe, { ProbeResult } from 'probe-image-size';

@Injectable()
export class FilesystemService {
  private s3: S3Client;
  private readonly utils = Utils;
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 30000;

  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
  ) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('s3.region') ?? 'us-east-1',
      endpoint: this.configService.get<string>('s3.endpoint'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.configService.get<string>('s3.accessKeyId') ?? '',
        secretAccessKey:
          this.configService.get<string>('s3.secretAccessKey') ?? '',
      },
      maxAttempts: this.MAX_RETRIES,
    });
  }

  // ============================================================================
  // MAIN UPLOAD METHOD
  // ============================================================================

  async uploadSingleFileByUser(dto: uploadSingleFileByUserDTo) {
    const { userId, roomId, file, id, messageId } = dto;
    if (!file?.buffer) throw new Error('File or buffer is missing');

    // Validate user and room
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const roomPair = this.utils.pairRoomId(user.usr_id, roomId);
    const room = await this.roomModel.findOne({
      room_id: { $in: [roomId, roomPair] },
    });
    if (!room) throw new NotFoundException('Room not found');

    // Prepare file metadata
    const timestamp = Date.now();
    const ext = file.originalname.split('.').pop() || 'bin';
    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    const fileName = `${this.slugify(nameWithoutExt)}_${timestamp}.${ext}`;
    const folder = room.room_id;
    const fileUrl = `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${folder}/${fileName}`;

    // Determine file kind
    const kind = this.getFileKind(file.mimetype);

    // Extract metadata
    const metadata = (await this.extractMetadata(
      file.buffer,
      file.mimetype,
    )) as { width?: number; height?: number; duration?: number };

    // Create/update attachment record
    const isValidId = id && /^[0-9a-fA-F]{24}$/.test(id);
    const attachmentData: Partial<Attachment> & { _id?: any } = {
      kind,
      url: fileUrl,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      user_id: this.utils.convertToObjectIdMongoose(userId),
      room_id: room._id,
      status: 'processing' as const,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      ...(messageId && {
        contextId: this.utils.convertToObjectIdMongoose(messageId),
      }),
    };

    // Nếu có id hợp lệ, thêm vào attachmentData để dùng làm _id
    if (id && isValidId) {
      attachmentData._id = this.utils.convertToObjectIdMongoose(id);
    }

    let attachment: Attachment & { _id: any };
    if (id && isValidId) {
      // Thử update, nếu không tồn tại thì create với _id đã định sẵn
      attachment =
        (await this.attachmentModel.findByIdAndUpdate(id, attachmentData, {
          new: true,
        })) || (await this.attachmentModel.create(attachmentData));
    } else {
      attachment = await this.attachmentModel.create(attachmentData);
    }

    // Upload to S3 with retry
    try {
      await this.uploadToS3WithRetry({
        Bucket: this.configService.get<string>('s3.bucketName'),
        Key: `${folder}/${fileName}`,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: ObjectCannedACL.public_read,
      });

      await this.attachmentModel.findByIdAndUpdate(attachment._id, {
        status: 'uploaded',
      });

      return Response.success(
        {
          _id: this.objectIdToString(attachment._id),
          url: fileUrl,
          kind,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          status: 'uploaded',
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
        },
        'Upload successful',
      );
    } catch (error) {
      await this.attachmentModel.findByIdAndUpdate(attachment._id, {
        status: 'failed',
      });
      throw error;
    }
  }

  // ============================================================================
  // OTHER PUBLIC METHODS
  // ============================================================================

  async uploadSingleFile(file: MulterFile, folder = 'uploads') {
    const timestamp = Date.now();
    const ext = file.originalname.split('.').pop() ?? 'bin';
    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    const fileName = `${this.slugify(nameWithoutExt)}_${timestamp}.${ext}`;

    await this.uploadToS3WithRetry({
      Bucket: this.configService.get<string>('s3.bucketName'),
      Key: `${folder}/${fileName}`,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: ObjectCannedACL.public_read,
    });

    const url = `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${folder}/${fileName}`;
    return Response.success({ url }, 'Upload successful');
  }

  async uploadMultipleFiles(files: MulterFile[], folder = 'uploads') {
    type UploadSingleFileResponse = { metadata: { url: string } };
    const results: UploadSingleFileResponse[] = await Promise.all(
      files.map(
        (file) =>
          this.uploadSingleFile(
            file,
            folder,
          ) as Promise<UploadSingleFileResponse>,
      ),
    );
    return Response.success({
      urls: results.map((r) => r.metadata.url),
      totalFiles: results.length,
    });
  }

  async deleteFile(fileName: string, folder = 'uploads') {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.configService.get<string>('s3.bucketName'),
        Key: `${folder}/${fileName}`,
      }),
    );
    return { message: 'File deleted successfully' };
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

  // ============================================================================
  // S3 UPLOAD WITH RETRY
  // ============================================================================

  private async uploadToS3WithRetry(
    uploadParams: any,
    retries = this.MAX_RETRIES,
  ): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const uploadPromise = this.s3.send(new PutObjectCommand(uploadParams));
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${this.TIMEOUT_MS}ms`)),
            this.TIMEOUT_MS,
          ),
        );
        await Promise.race([uploadPromise, timeoutPromise]);
        return;
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ============================================================================
  // METADATA EXTRACTION
  // ============================================================================

  private async extractMetadata(
    buf: Buffer,
    mime?: string,
  ): Promise<{ width?: number; height?: number; duration?: number }> {
    const type = this.classifyType(mime);
    if (type === 'image') return this.extractImageMetadata(buf);
    if (type === 'video') return this.extractVideoMetadata(buf);
    if (type === 'audio') return this.extractAudioMetadata(buf);
    return {};
  }

  private async extractImageMetadata(
    buf: Buffer,
  ): Promise<{ width?: number; height?: number }> {
    // Try sharp
    try {
      const meta = await sharp(buf).metadata();
      return { width: meta.width, height: meta.height };
    } catch {
      // Ignore errors from sharp
    }

    // Try probe-image-size
    try {
      // probe-image-size exports a 'sync' method for buffer probing
      if (
        typeof (probe as { sync?: (input: Buffer) => ProbeResult }).sync ===
        'function'
      ) {
        const syncProbe = (probe as { sync?: (input: Buffer) => ProbeResult })
          .sync;
        if (typeof syncProbe === 'function') {
          const probeResultOrError = syncProbe(buf);
          if (
            probeResultOrError &&
            typeof probeResultOrError === 'object' &&
            !(probeResultOrError instanceof Error) &&
            'width' in probeResultOrError &&
            'height' in probeResultOrError &&
            typeof (probeResultOrError as ProbeResult).width === 'number' &&
            typeof (probeResultOrError as ProbeResult).height === 'number'
          ) {
            const probeResult = probeResultOrError as ProbeResult;
            return {
              width: probeResult.width,
              height: probeResult.height,
            };
          }
        }
      }
      /* ignore */
    } catch {
      // Ignore errors from probe-image-size
    }

    return {};
  }

  private async extractVideoMetadata(
    buf: Buffer,
  ): Promise<{ width?: number; height?: number; duration?: number }> {
    try {
      if (!ffmpegStatic?.path || !ffmpeg) return {};

      ffmpeg.setFfprobePath(ffmpegStatic.path);

      const tmpFile = path.join(os.tmpdir(), `video_${Date.now()}.tmp`);
      await fs.writeFile(tmpFile, buf);

      return new Promise<{
        width?: number;
        height?: number;
        duration?: number;
      }>((resolve) => {
        ffmpeg(tmpFile).ffprobe((err: Error | null, data: any) => {
          fs.unlink(tmpFile).catch(() => {
            /* ignore */
          });
          if (err || !data?.streams?.[0]) return resolve({});

          const stream = data.streams[0];
          resolve({
            width: stream.width,
            height: stream.height,
            duration: Number.parseFloat(
              stream.duration || data.format?.duration || 0,
            ),
          });
        });
      });
    } catch {
      return {};
    }
  }

  private async extractAudioMetadata(
    buf: Buffer,
  ): Promise<{ duration?: number }> {
    try {
      const { parseBuffer } = await import('music-metadata');
      const meta = await parseBuffer(buf);
      return { duration: meta.format.duration };
    } catch {
      return {};
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  private getFileKind(mimeType?: string): AttachmentKind {
    if (!mimeType) return 'file';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
  }

  private classifyType(mime?: string): 'image' | 'video' | 'audio' | 'other' {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'other';
  }

  private objectIdToString(id: unknown): string {
    if (typeof id === 'string') return id;
    if (id && typeof (id as { toString?: unknown }).toString === 'function') {
      return (id as { toString: () => string }).toString();
    }
    return String(id);
  }
}
