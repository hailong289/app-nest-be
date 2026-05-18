import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants/services';
import { firstValueFrom, Observable, timeout } from 'rxjs';

interface AiGrpcService {
  translation(data: {
    text: string;
    from: string;
    to: string;
    model?: string | null;
    userId: string;
  }): Observable<{
    statusCode: number;
    metadata?: { translated_text?: string };
  }>;
}

@Injectable()
export class AiTranslationClient implements OnModuleInit {
  private readonly logger = new Logger(AiTranslationClient.name);
  private service!: AiGrpcService;

  constructor(@Inject(SERVICES.AI) private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.service = this.client.getService<AiGrpcService>('AIService');
  }

  async translate(input: {
    text: string;
    from: string;
    to: string;
    userId: string;
  }): Promise<string> {
    if (!input.text.trim()) return '';

    try {
      const res = await firstValueFrom(
        this.service.translation(input).pipe(timeout(30_000)),
      );
      if (res.statusCode !== 200) return '';
      return res.metadata?.translated_text?.trim() || '';
    } catch (error) {
      this.logger.warn(
        `Translation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }
}
