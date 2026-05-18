import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants/services';
import { firstValueFrom, Observable, timeout } from 'rxjs';

interface SfuGrpcService {
  TranscribeAudioUrl(data: {
    audioUrl: string;
    mimeType?: string;
    sourceLanguage?: string;
    userId: string;
  }): Observable<{ transcript: string; detectedLanguage: string }>;
}

@Injectable()
export class SfuTranscriptionClient implements OnModuleInit {
  private readonly logger = new Logger(SfuTranscriptionClient.name);
  private service!: SfuGrpcService;

  constructor(@Inject(SERVICES.SFU) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.service = this.client.getService<SfuGrpcService>('SfuService');
  }

  async transcribeAudioUrl(input: {
    audioUrl: string;
    mimeType?: string;
    sourceLanguage?: string;
    userId: string;
  }): Promise<{ transcript: string; detectedLanguage: string }> {
    try {
      return await firstValueFrom(
        this.service
          .TranscribeAudioUrl({
            audioUrl: input.audioUrl,
            mimeType: input.mimeType || '',
            sourceLanguage: input.sourceLanguage || '',
            userId: input.userId,
          })
          .pipe(timeout(180_000)),
      );
    } catch (error) {
      this.logger.error(
        `SFU TranscribeAudioUrl failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
