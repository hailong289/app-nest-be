import {
  DeleteObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Response } from '@app/helpers/response';
import { InjectModel } from '@nestjs/mongoose';
import { Attachment, AttachmentKind } from 'libs/db/src';
import { Model, FilterQuery } from 'mongoose';
import Utils from '@app/helpers/utils';
import {
  MulterFile,
  uploadSingleFileByUserDTo,
  UploadMultipleFilesByUserDto,
  GetAttachmentsDto,
} from '@app/dto';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import ffmpegStatic from '@ffprobe-installer/ffprobe';
import ffmpegImport from 'fluent-ffmpeg';
const ffmpeg: typeof import('fluent-ffmpeg') = ffmpegImport;
import sharp from 'sharp';
import probe from 'probe-image-size';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ClientKafka } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent } from '@app/dto/enum.type';
import { firstValueFrom } from 'rxjs';

interface AuthGrpcClient {
  GetUserById(data: { userId: string }): any;
}

interface ChatGrpcClient {
  GetRoomById(data: { roomId: string }): any;
  AddAttachmentToMessage(data: { messageId: string; attachmentId: string }): any;
}

type GrpcResponse<T = any> = {
  statusCode?: number;
  metadata?: T;
};

@Injectable()
export class FilesystemService implements OnModuleInit {
  private s3: S3Client;
  private readonly utils = Utils;
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 30000;
  private authGrpcClient: AuthGrpcClient;
  private chatGrpcClient: ChatGrpcClient;

  constructor(
    private configService: ConfigService,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @Inject(SERVICES.AI) private readonly aiClient: ClientKafka,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
    @Inject(SERVICES.CHAT)
    private readonly chatGrpc: ClientGrpc,
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

  onModuleInit() {
    this.authGrpcClient = this.authGrpc.getService<AuthGrpcClient>('AuthService');
    this.chatGrpcClient = this.chatGrpc.getService<ChatGrpcClient>('ChatService');
  }

  private toFilesystemUser(u: Record<string, any> | null | undefined) {
    if (!u) return null;
    return {
      ...u,
      _id: u._id ?? u.id ?? '',
      usr_id: u.usr_id ?? u.id ?? u._id ?? '',
      usr_fullname: u.usr_fullname ?? u.fullname ?? '',
      usr_avatar: u.usr_avatar ?? u.avatar ?? '',
    };
  }

  private async lookupUserById(userId: string) {
    try {
      const result = (await firstValueFrom(
        this.authGrpcClient.GetUserById({ userId }),
      )) as GrpcResponse<Record<string, any>>;
      return this.toFilesystemUser(result.metadata);
    } catch {
      return null;
    }
  }

  private async lookupRoomById(roomId: string) {
    try {
      const result = (await firstValueFrom(
        this.chatGrpcClient.GetRoomById({ roomId }),
      )) as GrpcResponse<Record<string, any>>;
      return result.statusCode === 200 ? result.metadata : null;
    } catch {
      return null;
    }
  }

  private async resolveRoom(roomId: string, userUsrId?: string) {
    const room =
      (await this.lookupRoomById(roomId)) ||
      (userUsrId
        ? await this.lookupRoomById(this.utils.pairRoomId(userUsrId, roomId))
        : null);

    if (room?._id) {
      return {
        ...room,
        _id: this.utils.convertToObjectIdMongoose(String(room._id)),
        room_id: room.roomId ?? room.id ?? roomId,
      };
    }

    if (Utils.isValidObjectId(roomId)) {
      return {
        _id: this.utils.convertToObjectIdMongoose(roomId),
        room_id: roomId,
      };
    }

    return null;
  }

  private async addAttachmentToMessage(messageId: string, attachmentId: string) {
    await firstValueFrom(
      this.chatGrpcClient.AddAttachmentToMessage({ messageId, attachmentId }),
    );
  }

  // ============================================================================
  // MAIN UPLOAD METHOD
  // ============================================================================

  async uploadSingleFileByUser(dto: uploadSingleFileByUserDTo) {
    const { userId, roomId, file, id, messageId } = dto;
    if (!file?.buffer) throw new Error('File or buffer is missing');

    // Validate user and room
    const user = await this.lookupUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    const room = await this.resolveRoom(roomId, user.usr_id);
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
      user_id: this.utils.convertToObjectIdMongoose(String(user._id)),
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

      // Emit event for AI processing
      if (['image', 'video', 'file', 'audio'].includes(kind) && messageId) {
        await this.utils.dispatchEventKafka(
          this.aiClient,
          KafkaEvent.AI_PROCESS_FILE_EMBEDDING,
          {
            fileUrl,
            fileType: kind,
            docId: attachment._id,
            userId,
            mimeType: file.mimetype,
            messageId,
          },
        );
      }

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

  async uploadMultipleFilesByUser(dto: UploadMultipleFilesByUserDto) {
    const { files, userId, roomId, messageId } = dto;

    // Validate user and room once
    const user = await this.lookupUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    const room = await this.resolveRoom(roomId, user.usr_id);
    if (!room) throw new NotFoundException('Room not found');

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          // Reuse uploadSingleFileByUser logic but we need to bypass the user/room check to avoid redundant DB calls
          // However, uploadSingleFileByUser is tightly coupled with DB checks.
          // For simplicity and correctness, we can just call uploadSingleFileByUser for each file.
          // It might be slightly less efficient but ensures consistency.
          // Or we can refactor uploadSingleFileByUser to accept pre-fetched user/room.

          // Calling uploadSingleFileByUser directly:
          const result = await this.uploadSingleFileByUser({
            userId,
            roomId,
            file: {
              ...file,
              fieldname: '',
              encoding: '7bit',
              size: file.buffer.length,
            },
            messageId,
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result.metadata;
        } catch (error) {
          console.error(`Failed to upload file ${file.originalname}:`, error);
          return null;
        }
      }),
    );

    const successfulUploads = results.filter((r) => r !== null);

    return Response.success(
      successfulUploads,
      'Upload multiple files successful',
    );
  }

  async getAttachments(dto: GetAttachmentsDto) {
    const { roomId, userId, type, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<Attachment> = {};
    if (roomId) {
      const room = await this.resolveRoom(roomId);

      if (room) {
        filter.room_id = room._id;
      } else {
        // If room not found, return empty list
        return Response.success([], 'Room not found');
      }
    }

    if (userId) {
      const user = await this.lookupUserById(userId);
      if (user) {
        filter.user_id = this.utils.convertToObjectIdMongoose(String(user._id));
      }
    }

    if (type) {
      if (type === 'media') {
        filter.kind = { $in: ['image', 'video', 'audio'] };
      } else {
        filter.kind = type as AttachmentKind;
      }
    }

    const attachments = await this.attachmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Map to response format
    const mapped = attachments.map((att) => ({
      _id: att._id.toString(),
      url: att.url,
      kind: att.kind,
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      status: att.status,
      width: att.width,
      height: att.height,
      duration: att.duration,
      createdAt: att.createdAt,
    }));

    return Response.success(mapped, 'Get attachments successful');
  }

  async getAttachmentsByIds(attachmentIds: string[]) {
    if (!attachmentIds || attachmentIds.length === 0) {
      return Response.success([], 'No attachment IDs provided');
    }

    const objectIds = attachmentIds
      .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
      .map((id) => this.utils.convertToObjectIdMongoose(id));

    if (objectIds.length === 0) {
      return Response.success([], 'No valid attachment IDs provided');
    }

    const attachments = await this.attachmentModel
      .find({ _id: { $in: objectIds } })
      .lean();

    const mapped = attachments.map((att) => ({
      _id: att._id.toString(),
      url: att.url,
      kind: att.kind,
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      status: att.status,
      width: att.width,
      height: att.height,
      duration: att.duration,
    }));

    return Response.success(mapped, 'Get attachments by IDs successful');
  }

  async processLinks(
    content: string,
    userId: string,
    roomId: any,
    messageId: any,
  ) {
    if (!content) return;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = content.match(urlRegex);
    if (!urls) return;

    const [room, user] = await Promise.all([
      this.resolveRoom(String(roomId)),
      this.lookupUserById(String(userId)),
    ]);
    if (!room || !user) return;

    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(response.data);

        const title =
          $('meta[property="og:title"]').attr('content') ||
          $('title').text() ||
          url;
        const image = $('meta[property="og:image"]').attr('content') || '';

        const attachment = await this.attachmentModel.create({
          room_id: room._id,
          user_id: this.utils.convertToObjectIdMongoose(String(user._id)),
          kind: 'link',
          url: url,
          name: title,
          thumbUrl: image,
          contextId: this.utils.convertToObjectIdMongoose(messageId),
          status: 'uploaded',
          mimeType: 'text/html',
          size: 0,
        });

        await this.addAttachmentToMessage(
          String(messageId),
          this.objectIdToString(attachment._id),
        );
      } catch (e) {
        console.error(
          `Failed to process link ${url}: ${
            typeof e === 'object' && e && 'message' in e
              ? String((e as { message?: unknown }).message)
              : String(e)
          }`,
        );
      }
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
    uploadParams: PutObjectCommandInput,
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
      // eslint-disable-next-line
      const probeAny = probe as any;
      // eslint-disable-next-line
      if (typeof probeAny.sync === 'function') {
        // eslint-disable-next-line
        const result = probeAny.sync(buf);
        if (result) {
          // eslint-disable-next-line
          return { width: result.width, height: result.height };
        }
      }
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
          // eslint-disable-next-line
          if (err || !data || !data.streams || !data.streams[0])
            return resolve({});

          // eslint-disable-next-line
          const stream = data.streams[0];
          resolve({
            // eslint-disable-next-line
            width: stream.width,
            // eslint-disable-next-line
            height: stream.height,
            duration: Number.parseFloat(
              String(
                // eslint-disable-next-line
                stream.duration || (data.format && data.format.duration) || 0,
              ),
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
