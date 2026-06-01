import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from '@app/helpers/utils';

@Injectable()
export class AuthGatewayClient {
  private readonly logger = new Logger(AuthGatewayClient.name);

  constructor(private readonly configService: ConfigService) {}

  async post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    const baseUrl = (
      this.configService.get<string>('GATEWAY_URL') || 'http://localhost:5000'
    ).replace(/\/+$/, '');
    const gatewayPath = baseUrl.endsWith('/api') ? path : `/api${path}`;
    const headers: Record<string, string> = {
      'x-internal-service': 'auth',
    };
    const internalSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (internalSecret) {
      headers['x-internal-secret'] = internalSecret;
    }

    try {
      const result = (await Utils.callApiGateway(
        `${baseUrl}${gatewayPath}`,
        'POST',
        body,
        headers,
        15_000,
      )) as T;
      if (
        result &&
        typeof result === 'object' &&
        'statusCode' in result &&
        Number((result as { statusCode?: number }).statusCode) >= 400
      ) {
        const message =
          'message' in result
            ? String((result as { message?: string }).message)
            : 'Gateway request failed';
        throw new Error(message);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Gateway POST ${path} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
