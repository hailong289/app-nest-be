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
import { Metadata } from '@grpc/grpc-js';

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
    timeoutMs = 5000,
  ): Promise<{ success: boolean } | ReturnType<typeof Response.error>> {
    if (this.request?.headers) {
      data.headers = this.request.headers;
    }
    try {
      await firstValueFrom(
        client.emit(pattern, data).pipe(
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
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  async dispatchGrpcRequest<T>(
    grpcMethod: (data: T, metadata?: Metadata) => Observable<unknown>,
    data: T,
    timeoutMs = 20000,
  ): Promise<unknown> {
    // Default timeout 20s
    try {
      // Add headers to data if request is available
      const metadata = new Metadata();
      if (this.request?.headers) {
        // Chỉ lấy các header cần thiết hoặc loop qua để add
        // Lưu ý: gRPC metadata values chỉ chấp nhận string hoặc Buffer
        const headers = this.request.headers;
        Object.keys(headers).forEach((key) => {
          const value = headers[key];
          if (value && typeof value === 'string') {
            metadata.add(key, value);
          }
        });
      }
      return await lastValueFrom(
        grpcMethod(data, metadata).pipe(
          timeout(timeoutMs),
          catchError((err: unknown) => {
            // Lấy message chi tiết hơn nếu có
            const error = err as { details?: string; message?: string };
            const detailedMessage =
              error.details || error.message || JSON.stringify(err);

            return throwError(
              () => new Error(`Service unavailable: ${detailedMessage}`),
            );
          }),
        ),
      );
    } catch (error) {
      console.log('🚀 ~ GatewayService ~ dispatchGrpcRequest ~ error:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }
}
