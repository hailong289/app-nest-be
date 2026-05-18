import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants/services';
import { firstValueFrom, Observable, timeout } from 'rxjs';
import type { TranscriptPayload } from './transcription.types';

interface ChatGrpcService {
  SaveCallTranscriptSegment(data: {
    callId: string;
    roomId: string;
    speakerUserId: string;
    segmentId: string;
    text: string;
    translatedText?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    startedAt: string;
    endedAt: string;
  }): Observable<{ statusCode: number }>;
}

@Injectable()
export class ChatTranscriptClient implements OnModuleInit {
  private readonly logger = new Logger(ChatTranscriptClient.name);
  private service!: ChatGrpcService;

  constructor(@Inject(SERVICES.CHAT) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.service = this.client.getService<ChatGrpcService>('ChatService');
  }

  async save(payload: TranscriptPayload): Promise<void> {
    if (!payload.isFinal || !payload.text.trim()) return;

    try {
      await firstValueFrom(
        this.service
          .SaveCallTranscriptSegment({
            callId: payload.callId,
            roomId: payload.roomId,
            speakerUserId: payload.speakerUserId,
            segmentId: payload.segmentId,
            text: payload.text,
            translatedText: payload.translatedText || '',
            sourceLanguage: payload.sourceLanguage || '',
            targetLanguage: payload.targetLanguage || '',
            startedAt: payload.startedAt,
            endedAt: payload.endedAt,
          })
          .pipe(timeout(15_000)),
      );
    } catch (error) {
      this.logger.warn(
        `Save transcript segment failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
