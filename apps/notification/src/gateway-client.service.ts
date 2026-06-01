import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from '@app/helpers/utils';

interface GatewayConfig {
  url: string;
  internalSecret?: string;
}

export interface FcmTokensForUser {
  userId: string;
  fcmTokens: string[];
}

export interface BusinessUserMapping {
  usrId: string;
  userId: string;
}

@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async getFcmTokensForUsers(userIds: string[]): Promise<FcmTokensForUser[]> {
    const result = await this.post('/internal/auth/users/fcm-tokens', {
      userIds,
    });

    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Resolve FCM tokens failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items) ? (items as FcmTokensForUser[]) : [];
  }

  async resolveBusinessIds(usrIds: string[]): Promise<BusinessUserMapping[]> {
    const result = await this.post(
      '/internal/auth/users/resolve-business-ids',
      {
        usrIds,
      },
    );

    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Resolve business ids failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items) ? (items as BusinessUserMapping[]) : [];
  }

  private async post(path: string, body: Record<string, unknown>) {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const baseUrl = (cfg?.url || 'http://localhost:5000').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'x-internal-service': 'notification',
    };
    if (cfg?.internalSecret) {
      headers['x-internal-secret'] = cfg.internalSecret;
    }

    const gatewayPath = baseUrl.endsWith('/api') ? path : `/api${path}`;
    return Utils.callApiGateway(
      `${baseUrl}${gatewayPath}`,
      'POST',
      body,
      headers,
      15_000,
    );
  }
}
