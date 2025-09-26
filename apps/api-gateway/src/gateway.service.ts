import { Injectable } from '@nestjs/common';
import { ClientKafka, ClientProxy } from '@nestjs/microservices';
import { Response } from 'libs/helpers/response';
import { catchError, firstValueFrom, lastValueFrom, throwError, timeout } from 'rxjs';

@Injectable()
export class GatewayService {
  protected request: Request;

  getHealth(): string {
    return 'API Gateway is healthy!';
  }

  withRequestScope(request) {
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

  async dispatchServiceRequest(client: ClientProxy | ClientKafka, pattern: string, data: any = {}, timeoutMs = 20000) { // Default timeout 20s
    if (this.request && this.request.headers) {
      data.headers = this.request.headers;
    }
    try {
      return await firstValueFrom(
        client.send(pattern, data).pipe(
          timeout(timeoutMs),
          catchError((err) => {
            return throwError(() => new Error(`Service unavailable: ${err.message || err}`));
          }),
        ),
      );
    } catch (error) {
       return Response.error(error.message || error, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  async dispatchServiceEvent(client: ClientProxy | ClientKafka, pattern: string, data: any = {}) {
    if (this.request && this.request.headers) {
      data.headers = this.request.headers;
    }
    try {
      await firstValueFrom(
        client.emit(pattern, data).pipe(
          timeout(5000),
          catchError((err) => {
            return throwError(() => new Error(`Service unavailable: ${err.message || err}`));
          }),
        ),
      );
      return { success: true };
    } catch (error) {
      return Response.error(error.message || error, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  async dispatchGrpcRequest<T>(grpcMethod: (...args: any[]) => any, data: any, timeoutMs = 20000) { // Default timeout 20s
    try {
      if (this.request && this.request.headers) {
        data.headers = this.request.headers;
      }
      return await lastValueFrom(
        grpcMethod(data).pipe(
          timeout(timeoutMs),
          catchError((err) => {
            return throwError(() => new Error(`Service unavailable: ${err.message || err}`));
          }),
        ),
      );
    } catch (error) {
      return Response.error(error.message || error, 503, 'SERVICE_UNAVAILABLE');
    }
  }
}