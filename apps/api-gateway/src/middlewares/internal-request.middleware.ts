import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { Response as ResponseHelper } from 'libs/helpers/response';

const ALLOWED_INTERNAL_SERVICES = new Set([
  'auth',
  'chat',
  'filesystem',
  'learning',
  'ai',
  'notification',
  'socket',
]);

@Injectable()
export class InternalRequestMiddleware implements NestMiddleware {
  private readonly logger = new Logger(InternalRequestMiddleware.name);

  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const internalService = String(req.headers['x-internal-service'] || '');
    const internalSecret = String(req.headers['x-internal-secret'] || '');

    res.on('finish', () => {
      this.logger.log(
        `${req.method} ${req.originalUrl} caller=${internalService || 'unknown'} status=${res.statusCode} latencyMs=${Date.now() - startedAt}`,
      );
    });

    if (!internalService || !ALLOWED_INTERNAL_SERVICES.has(internalService)) {
      return res
        .status(401)
        .json(
          ResponseHelper.error(
            'Invalid internal service',
            401,
            'UNAUTHORIZED',
          ),
        );
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      return res
        .status(401)
        .json(
          ResponseHelper.error(
            'Invalid internal secret',
            401,
            'UNAUTHORIZED',
          ),
        );
    }

    next();
  }
}
