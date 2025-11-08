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
import * as crypto from 'node:crypto';
import {
  FileMetadata,
  ImageMetadata,
  VideoMetadata,
  AudioMetadata,
} from './types';

@Injectable()
export class FilesystemService {
  private s3: S3Client;
  private readonly utils = Utils;
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 30000; // 30 seconds

  constructor(
    private configService: ConfigService,
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Attachment')
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel('Room') private readonly roomModel: Model<Room>,
  ) {
    try {
      const endpoint = this.configService.get<string>('s3.endpoint');
      const region = this.configService.get<string>('s3.region') ?? 'us-east-1';

      this.s3 = new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.configService.get<string>('s3.accessKeyId') ?? '',
          secretAccessKey:
            this.configService.get<string>('s3.secretAccessKey') ?? '',
        },
        // Tối ưu timeout và retry
        maxAttempts: this.MAX_RETRIES,
      });

      console.log(
        `🔥 S3 Client initialized - Endpoint: ${endpoint}, Region: ${region}`,
      );
    } catch (error) {
      console.error('❌ S3 Client initialization error:', error);
      throw error;
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

  /**
   * Upload to S3 with retry logic and better error handling
   */
  private async uploadToS3WithRetry(
    uploadParams: any,
    retries: number = this.MAX_RETRIES,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`☁️ S3 upload attempt ${attempt}/${retries}...`);

        // Set timeout cho mỗi attempt
        const uploadPromise = this.s3.send(new PutObjectCommand(uploadParams));
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`Upload timeout after ${this.TIMEOUT_MS}ms`)),
            this.TIMEOUT_MS,
          ),
        );

        await Promise.race([uploadPromise, timeoutPromise]);

        console.log(`✅ S3 upload successful on attempt ${attempt}`);
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(
          `❌ S3 upload attempt ${attempt} failed:`,
          lastError.message,
        );

        // Nếu chưa hết retries, đợi trước khi retry (exponential backoff)
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10s
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // Tất cả attempts đều thất bại
    throw lastError || new Error('Upload failed after all retries');
  }

  /**
   * Extract metadata from file based on type
   */
  private safeNumber(n: unknown): number | undefined {
    const x = Number(n);
    return Number.isFinite(x) ? x : undefined;
  }

  private getExtFromName(name: string): string | undefined {
    const ext = path.extname(name || '').toLowerCase();
    return ext ? ext.replace('.', '') : undefined;
  }

  private computeSHA1(buf: Buffer): string {
    return crypto.createHash('sha1').update(buf).digest('hex');
  }

  private async detectMimeAndExt(buf: Buffer, fallbackExt?: string) {
    try {
      const fileTypeModule = await import('file-type');
      const fileType = await fileTypeModule.fileTypeFromBuffer(buf);
      if (fileType) {
        return { mime: fileType.mime, ext: fileType.ext };
      }
    } catch {
      // Ignore error if file-type not available
    }
    return { mime: undefined, ext: fallbackExt };
  }

  private classifyType(
    mimeFromServer?: string,
    mimeDetected?: string,
  ): 'image' | 'video' | 'audio' | 'other' {
    const m = (mimeDetected || mimeFromServer || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'other';
  }

  private async extractImage(buf: Buffer): Promise<ImageMetadata | undefined> {
    // 1) sharp (nếu có)
    try {
      const sharpMod = await import('sharp').catch(() => null);
      if (sharpMod) {
        const meta = await sharpMod.default(buf).metadata();
        const out: ImageMetadata = {
          width: this.safeNumber(meta.width),
          height: this.safeNumber(meta.height),
          format: meta.format ?? undefined,
          orientation: this.safeNumber(
            (meta as unknown as Record<string, unknown>).orientation,
          ),
        };

        // EXIF bằng exifr (nếu có, và sharp không parse đủ)
        try {
          const exifr = await import('exifr').catch(() => null);
          if (exifr?.parse) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const exif = await exifr
              .parse(buf, { tiff: true, exif: true, gps: true })
              .catch(() => null);
            if (exif && typeof exif === 'object') {
              const exifData = exif as Record<string, unknown>;
              out.exif = {
                make: (exifData.Make ?? exifData.make ?? undefined) as
                  | string
                  | undefined,
                model: (exifData.Model ?? exifData.model ?? undefined) as
                  | string
                  | undefined,
                dateTimeOriginal:
                  (exifData.DateTimeOriginal as Date)?.toISOString?.() ??
                  (exifData.DateTimeOriginal as string | undefined) ??
                  undefined,
                latitude:
                  typeof exifData.latitude === 'number'
                    ? exifData.latitude
                    : undefined,
                longitude:
                  typeof exifData.longitude === 'number'
                    ? exifData.longitude
                    : undefined,
              };
              if (
                !out.orientation &&
                typeof exifData.Orientation === 'number'
              ) {
                out.orientation = exifData.Orientation;
              }
            }
          }
        } catch {
          /* ignore */
        }

        return out;
      }
    } catch {
      /* ignore */
    }

    // 2) probe-image-size (fallback)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const probeModule = (await import('probe-image-size').catch(
        () => null,
      )) as any;
      if (probeModule) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const r = (await probeModule(buf)) as {
          width?: number;
          height?: number;
          type?: string;
        };
        if (r && typeof r === 'object') {
          return {
            width: this.safeNumber(r.width),
            height: this.safeNumber(r.height),
            format: r.type ?? undefined,
          };
        }
      }
    } catch {
      /* ignore */
    }

    return undefined;
  }

  private async extractAudioWithMusicMetadata(
    buf: Buffer,
    declaredMime?: string,
  ): Promise<AudioMetadata | undefined> {
    try {
      const mm = await import('music-metadata').catch(() => null);
      if (!mm) return undefined;
      const meta = await mm.parseBuffer(buf, { mimeType: declaredMime });
      const out: AudioMetadata = {
        duration: this.safeNumber(meta.format.duration),
        bitrate: this.safeNumber(meta.format.bitrate),
        sampleRate: this.safeNumber(meta.format.sampleRate),
        codec: meta.format.codec ?? undefined,
        channels: this.safeNumber(meta.format.numberOfChannels),
      };
      return out;
    } catch {
      return undefined;
    }
  }

  private async extractVideoWithFFprobe(
    buf: Buffer,
    suggestedExt = 'mp4',
  ): Promise<VideoMetadata | undefined> {
    // DISABLED: Cần cài @ffprobe-installer/ffprobe + fluent-ffmpeg
    // yarn add @ffprobe-installer/ffprobe fluent-ffmpeg @types/fluent-ffmpeg
    return undefined;

    /* Uncomment khi đã cài packages:
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [ffprobeInstaller, ffmpeg] = (await Promise.all([
        import('@ffprobe-installer/ffprobe').catch(() => null),
        import('fluent-ffmpeg').catch(() => null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ])) as any[];

      const ffprobePath = ffprobeInstaller?.path;

      if (!ffmpeg || !ffprobePath) return undefined;

      // Ghi tạm ra file (ffprobe cần path)
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-'));
      const filePath = path.join(tmp, `upload.${suggestedExt}`);
      await fs.writeFile(filePath, buf);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      ffmpeg.default.setFfprobePath(ffprobePath);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const probe = await new Promise<any>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        ffmpeg.default.ffprobe(
          filePath,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err: any, data: any) => {
            if (err) reject(new Error(String(err)));
            else resolve(data);
          },
        );
      });

      // Dọn file tạm (không chờ)
      void fs.unlink(filePath).catch(() => {});
      void fs.rm(tmp, { recursive: true, force: true }).catch(() => {});

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const fmt = probe?.format ?? {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const streams: unknown[] = Array.isArray(probe?.streams)
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          probe.streams
        : [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const vStream: any =
        streams.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: any) => s?.codec_type === 'video',
        ) || {};

      const r: VideoMetadata = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        duration: this.safeNumber(fmt.duration ?? vStream.duration),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        width: this.safeNumber(vStream.width),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        height: this.safeNumber(vStream.height),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        codec: vStream.codec_name ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        rotation: this.safeNumber(vStream.rotation ?? vStream.tags?.rotate),
      };

      // FPS
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const rFrameRate: string | undefined = vStream.r_frame_rate;
      if (rFrameRate?.includes('/')) {
        const [a, b] = rFrameRate.split('/').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
          r.fps = +(a / b).toFixed(3);
        }
      }

      // Bitrate
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const br = this.safeNumber(fmt.bit_rate ?? vStream.bit_rate);
      if (br) r.bitrate = br;

      return r;
    } catch {
      return undefined;
    }
  }

  private async extractVideoFallback(
    buf: Buffer,
    declaredMime?: string,
  ): Promise<VideoMetadata | undefined> {
    // music-metadata đọc được duration/codec, đôi khi không có width/height
    try {
      const mm = await import('music-metadata').catch(() => null);
      if (!mm) return undefined;
      const meta = await mm.parseBuffer(buf, { mimeType: declaredMime });
      const out: VideoMetadata = {
        duration: this.safeNumber(meta.format.duration),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        width: this.safeNumber((meta.format as any).width),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        height: this.safeNumber((meta.format as any).height),
        codec: meta.format.codec ?? undefined,
      };
      return out;
    } catch {
      return undefined;
    }
  }

  public async extractFileMetadata(file: MulterFile): Promise<FileMetadata> {
    const base: FileMetadata['base'] = {
      filename: file.originalname,
      ext: this.getExtFromName(file.originalname),
      mimeFromServer: file.mimetype,
      size: file.size,
      type: 'other',
    };

    // Hash (tuỳ chọn, có thể comment nếu không cần)
    try {
      base.sha1 = this.computeSHA1(file.buffer);
    } catch {
      /* ignore */
    }

    // Detect mime/extension thực tế
    let detectedMime: string | undefined;
    let detectedExt: string | undefined;
    try {
      const d = await this.detectMimeAndExt(file.buffer, base.ext);
      detectedMime = d.mime;
      detectedExt = d.ext;
      if (detectedExt && !base.ext) base.ext = detectedExt;
    } catch {
      /* ignore */
    }

    // Phân loại type
    base.mimeDetected = detectedMime;
    base.type = this.classifyType(base.mimeFromServer, base.mimeDetected);

    const output: FileMetadata = { base };

    // IMAGE
    if (base.type === 'image') {
      output.image = await this.extractImage(file.buffer);
      return output;
    }

    // VIDEO
    if (base.type === 'video') {
      // Ưu tiên ffprobe (nếu có)
      output.video =
        (await this.extractVideoWithFFprobe(
          file.buffer,
          detectedExt || base.ext || 'mp4',
        )) ||
        (await this.extractVideoFallback(file.buffer, base.mimeFromServer)) ||
        undefined;
      return output;
    }

    // AUDIO
    if (base.type === 'audio') {
      output.audio = await this.extractAudioWithMusicMetadata(
        file.buffer,
        base.mimeFromServer,
      );
      return output;
    }

    // OTHER → không làm gì thêm
    return output;
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
      await this.uploadToS3WithRetry(uploadParams);
      const url = `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${folder}/${fileName}`;

      return Response.success({ url }, 'Tải hình ảnh thành công');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Upload failed after retries:', errorMessage);

      return Response.error(
        'Tải ảnh thất bại: ' + errorMessage,
        400,
        'ERROR_FILESYSTEM',
        error,
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
    if (!file?.buffer) {
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

    // 🔍 Extract metadata từ file
    console.log('🔍 Extracting metadata...');
    const metadata = await this.extractFileMetadata(file);

    const attachmentData = {
      kind,
      url: fileUrl,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      user_id: this.utils.convertToObjectIdMongoose(userId),
      room_id: finInfo._id,
      status: 'processing' as const,
      // Add metadata fields
      width: metadata.image?.width || metadata.video?.width,
      height: metadata.image?.height || metadata.video?.height,
      duration: metadata.video?.duration || metadata.audio?.duration,
    };

    // Define a type that includes _id
    type AttachmentWithId = Attachment & { _id: string };

    let attachment: AttachmentWithId;

    // 1️⃣ Tạo hoặc update attachment record TRƯỚC KHI upload S3
    try {
      // Validate ID: Chỉ cho phép update nếu là valid MongoDB ObjectId
      const isValidObjectId = id && /^[0-9a-fA-F]{24}$/.test(id);

      if (id && isValidObjectId) {
        // Update existing attachment (retry sau khi upload fail)
        console.log('🔄 Updating existing attachment:', id);
        const updated = await this.attachmentModel.findOneAndUpdate(
          { _id: id },
          attachmentData,
          { new: true },
        );

        if (updated) {
          attachment = {
            ...(updated.toObject ? updated.toObject() : updated),
            _id: updated._id.toString(),
          } as AttachmentWithId;
        } else {
          // ID không tìm thấy, tạo mới
          console.log('⚠️ Attachment not found, creating new one');
          const created = await this.attachmentModel.create(attachmentData);
          attachment = {
            ...(created.toObject ? created.toObject() : created),
            _id: created._id.toString(),
          } as AttachmentWithId;
        }
      } else {
        // Tạo mới attachment (lần upload đầu tiên hoặc ID không hợp lệ)
        if (id && !isValidObjectId) {
          console.log(
            '⚠️ Invalid ID format (temp ID), creating new attachment:',
            id,
          );
        }
        const created = await this.attachmentModel.create(attachmentData);
        attachment = {
          ...(created.toObject ? created.toObject() : created),
          _id: created._id.toString(),
        } as AttachmentWithId;
      }

      const attachmentId = attachment._id;
      console.log('✅ Attachment record created/updated:', attachmentId);
    } catch (dbError: any) {
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

    // 2️⃣ Upload lên S3 với retry logic
    try {
      await this.uploadToS3WithRetry(uploadParams);

      const attachmentId = attachment._id;
      console.log('✅ S3 upload successful for attachment:', attachmentId);

      // 3️⃣ Update status thành công
      await this.attachmentModel.findByIdAndUpdate(attachmentId, {
        status: 'uploaded',
      });

      return Response.success(
        {
          _id: attachmentId?.toString() ?? '',
          url: fileUrl,
          kind,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          status: 'uploaded',
          // Include metadata in response
          width: attachment.width,
          height: attachment.height,
          duration: attachment.duration,
        },
        'Tải file thành công',
      );
    } catch (s3Error) {
      const attachmentId = attachment._id;
      console.error(
        '❌ S3 upload error for attachment:',
        attachmentId,
        s3Error,
      );

      // 4️⃣ Update status thất bại
      await this.attachmentModel.findByIdAndUpdate(attachmentId, {
        status: 'failed',
      });

      const errorMessage =
        s3Error instanceof Error ? s3Error.message : 'Unknown error';
      return Response.error(
        'Tải file lên S3 thất bại sau ' +
          this.MAX_RETRIES +
          ' lần thử: ' +
          errorMessage,
        400,
        'ERROR_FILESYSTEM',
        s3Error,
      );
    }
  }
}
