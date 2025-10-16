import { Injectable } from '@nestjs/common';
import { ClientKafka, ClientProxy } from '@nestjs/microservices';
import { Response } from 'libs/helpers/response';
import {
  catchError,
  firstValueFrom,
  lastValueFrom,
  Observable,
  throwError,
  timeout,
} from 'rxjs';
import { Request } from 'express';

@Injectable()
export class GatewayService {
  protected request?: Request;

  getHealth(): string {
    return 'API Gateway is healthy!';
  }

  withRequestScope(request: Request): this {
    this.request = request;
    return this;
  }

  getGatewayInfo() {
    return {
      service: 'API Gateway',
      version: '1.0.0',
      description: 'Main entry point for microservices',
      endpoints: {
        auth: ['POST /auth/login', 'POST /auth/register'],
        chat: ['GET /chat/messages', 'POST /chat/send'],
      },
    };
  }

  async dispatchServiceRequest(
    client: ClientProxy | ClientKafka,
    pattern: string,
    data: Record<string, unknown> = {},
    timeoutMs = 20000,
  ): Promise<unknown> {
    // Default timeout 20s
    if (this.request?.headers) {
      data.headers = this.request.headers;
    }
    try {
      return await firstValueFrom(
        client.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((err: unknown) => {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return throwError(
              () => new Error(`Service unavailable: ${errorMessage}`),
            );
          }),
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  async dispatchServiceEvent(
    client: ClientProxy | ClientKafka,
    pattern: string,
    data: Record<string, unknown> = {},
  ): Promise<{ success: boolean } | ReturnType<typeof Response.error>> {
    if (this.request?.headers) {
      data.headers = this.request.headers;
    }
    try {
      await firstValueFrom(
        client.emit(pattern, data).pipe(
          timeout(5000),
          catchError((err: unknown) => {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return throwError(
              () => new Error(`Service unavailable: ${errorMessage}`),
            );
          }),
        ),
      );
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  async dispatchGrpcRequest<T>(
    grpcMethod: (data: T) => Observable<unknown>,
    data: T,
    timeoutMs = 20000,
  ): Promise<unknown> {
    // Default timeout 20s
    try {
      // Add headers to data if request is available
      let dataWithHeaders = data;
      if (this.request?.headers && typeof data === 'object' && data !== null) {
        dataWithHeaders = { ...data, headers: this.request.headers } as T;
      }
      return await lastValueFrom(
        grpcMethod(dataWithHeaders).pipe(
          timeout(timeoutMs),
          catchError((err: unknown) => {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return throwError(
              () => new Error(`Service unavailable: ${errorMessage}`),
            );
          }),
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }
}
