import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from '@app/helpers/utils';

interface GatewayConfig {
  url: string;
  internalSecret?: string;
}

@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async resolveAttachmentForAi(body: {
    attachmentId: string;
    messageId?: string;
    userId: string;
  }) {
    return this.post('/internal/filesystem/attachments/resolve-for-ai', body);
  }

  async persistAttachmentTranscript(
    attachmentId: string,
    body: {
      messageId?: string;
      userId: string;
      transcript: string;
      detectedLanguage?: string;
    },
  ) {
    return this.post(
      `/internal/filesystem/attachments/${attachmentId}/transcript`,
      body,
    );
  }

  private async post(path: string, body: Record<string, unknown>) {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const baseUrl = (cfg?.url || 'http://localhost:5000').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'x-internal-service': 'ai',
    };
    if (cfg?.internalSecret) {
      headers['x-internal-secret'] = cfg.internalSecret;
    }

    const gatewayPath = baseUrl.endsWith('/api') ? path : `/api${path}`;
    const result = await Utils.callApiGateway(
      `${baseUrl}${gatewayPath}`,
      'POST',
      body,
      headers,
      15_000,
    );

    if (result?.statusCode && result.statusCode >= 400) {
      this.logger.warn(
        `Gateway call ${path} failed: ${result.reasonStatusCode || result.message}`,
      );
    }

    return result;
  }
}
