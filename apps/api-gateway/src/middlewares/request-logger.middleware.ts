import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP request logger for the api-gateway.
 *
 * Logs ONE line per request once the response has been sent. Format
 * (mirrors common nginx/morgan combined-style fields without the noise):
 *
 *   [HTTP] METHOD path → status (123ms) [user=:userId]
 *
 * Why a custom middleware instead of `morgan`:
 *   - Plays nicely with Nest's `Logger` (same color theming, log levels,
 *     and aggregation as the rest of the gateway logs).
 *   - Reads `req.user` populated by AuthMiddleware so we can attribute
 *     requests to a user without parsing the JWT a second time.
 *   - Skips the access-log noise channel: 4xx → warn, 5xx → error,
 *     2xx/3xx → log. Ops dashboards can filter by level.
 *
 * Wired in app.module.ts via `consumer.apply(...).forRoutes('*')` so it
 * fires before AuthMiddleware (and before all controllers).
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, originalUrl } = req;

    // `res.on('finish', ...)` fires AFTER the response is fully sent —
    // status code is final, body has been flushed. Don't log on the
    // request side; we want the actual outcome.
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const userIdRaw =
        (req as Request & { user?: { _id?: string } }).user?._id ?? null;
      const userTag = userIdRaw ? ` user=${userIdRaw}` : '';
      const message = `${method} ${originalUrl} → ${status} (${duration}ms)${userTag}`;

      if (status >= 500) {
        this.logger.error(message);
      } else if (status >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
