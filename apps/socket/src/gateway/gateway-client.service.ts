import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from 'libs/helpers/src/utils';

@Injectable()
export class SocketGatewayClient {
  private readonly logger = new Logger(SocketGatewayClient.name);

  constructor(private readonly configService: ConfigService) {}

  async post<T = any>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const baseUrl = (
      this.configService.get<string>('GATEWAY_INTERNAL_URL') ||
      this.configService.get<string>('GATEWAY_URL') ||
      'http://localhost:5000'
    ).replace(/\/+$/, '');
    const gatewayPath = baseUrl.endsWith('/api') ? path : `/api${path}`;
    const headers: Record<string, string> = {
      'x-internal-service': 'socket',
    };
    const internalSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (internalSecret) {
      headers['x-internal-secret'] = internalSecret;
    }

    const result = (await Utils.callApiGateway(
      `${baseUrl}${gatewayPath}`,
      'POST',
      body,
      headers,
      timeoutMs,
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
      this.logger.warn(`POST ${path} failed: ${message}`);
      throw new Error(message);
    }

    return result;
  }
}
