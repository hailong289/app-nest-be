import { Injectable } from '@nestjs/common';
import { ClientKafka, ClientProxy } from '@nestjs/microservices';
import { Response } from 'libs/helpers/response';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';

@Injectable()
export class GatewayService {
  getHealth(): string {
    return 'API Gateway is healthy!';
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

}