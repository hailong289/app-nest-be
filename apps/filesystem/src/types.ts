// types.ts
export interface BaseMetadata {
  filename: string;
  ext?: string;
  mimeFromServer?: string; // từ Multer
  mimeDetected?: string; // từ file-type
  size: number; // bytes
  sha1?: string;
  type: 'image' | 'video' | 'audio' | 'other';
}

export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string; // "jpeg","png","webp"... hoặc EXIF format
  orientation?: number; // từ EXIF nếu có
  exif?: {
    make?: string;
    model?: string;
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
  };
}

export interface VideoMetadata {
  duration?: number; // giây
  width?: number;
  height?: number;
  codec?: string; // h264, hevc, vp9,...
  rotation?: number; // 0/90/180/270
  fps?: number;
  bitrate?: number; // bps
}

export interface AudioMetadata {
  duration?: number; // giây
  bitrate?: number; // bps
  sampleRate?: number; // Hz
  codec?: string; // aac, opus, mp3...
  channels?: number;
}

export interface FileMetadata {
  base: BaseMetadata;
  image?: ImageMetadata;
  video?: VideoMetadata;
  audio?: AudioMetadata;
}

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
