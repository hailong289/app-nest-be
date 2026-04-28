import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { Metadata } from '@grpc/grpc-js';
import { Observable } from 'rxjs';

/**
 * Verify shared secret in gRPC metadata header `x-internal-secret`.
 * Apps/socket attaches this header on every RPC call to apps/sfu.
 */
@Injectable()
export class SharedSecretInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SharedSecretInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const metadata = context.switchToRpc().getContext<Metadata>();
    const expected = process.env.SFU_INTERNAL_SECRET;

    if (!expected) {
      this.logger.error(
        'SFU_INTERNAL_SECRET is not configured — refusing all requests',
      );
      throw new RpcException({ code: 16, message: 'Server misconfigured' });
    }

    const provided = this.extractSecret(metadata);
    if (provided !== expected) {
      this.logger.warn('Rejected RPC: invalid or missing x-internal-secret');
      throw new RpcException({ code: 16, message: 'Unauthenticated' });
    }

    return next.handle();
  }

  private extractSecret(metadata: Metadata): string | undefined {
    const values = metadata.get('x-internal-secret');
    if (values.length === 0) return undefined;
    const first = values[0];
    return typeof first === 'string' ? first : first.toString('utf8');
  }
}
