import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response as ExpressResponse } from 'express';
import { Response } from 'libs/helpers/response';

@Catch()
export class HttpExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 1) Phân loại lỗi
    let status = HttpStatus.INTERNAL_SERVER_ERROR; // 500 mặc định
    let message: string | string[] = 'Internal server error';
    let reason = HttpStatus[HttpStatus.INTERNAL_SERVER_ERROR]; // 'INTERNAL_SERVER_ERROR'

    if (exception instanceof HttpException) {
      status = exception.getStatus();

      const res = exception.getResponse();
      // res có thể là string hoặc object { statusCode, message, error, ... }
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const objRes = res as {
          message?: string | string[];
          error?: string;
          [key: string]: unknown;
        };
        message = objRes.message ?? objRes.error ?? JSON.stringify(objRes);
      }
      reason = HttpStatus[status] ?? reason;
    } else if (exception instanceof RpcException) {
      // Map toàn bộ RPC errors → 502 Bad Gateway (giống BadGatewayException)
      status = HttpStatus.BAD_GATEWAY;
      reason = HttpStatus[HttpStatus.BAD_GATEWAY]; // 'BAD_GATEWAY'

      const err = exception.getError?.();
      if (typeof err === 'string') message = err;
      else if (err && typeof err === 'object') {
        if (
          typeof err === 'object' &&
          err !== null &&
          'message' in err &&
          typeof (err as { message?: unknown }).message === 'string'
        ) {
          message = (err as { message: string }).message;
        } else {
          message = JSON.stringify(err);
        }
      } else {
        // fallback
        message =
          typeof exception === 'object' &&
          exception !== null &&
          'message' in exception &&
          typeof (exception as { message?: unknown }).message === 'string'
            ? (exception as { message: string }).message
            : 'Bad Gateway';
      }
    } else if (exception && typeof exception === 'object') {
      // Unknown error object → 502 (theo yêu cầu “lấy code từ BadGatewayException”)
      status = HttpStatus.BAD_GATEWAY;
      reason = HttpStatus[HttpStatus.BAD_GATEWAY];
      message =
        typeof exception === 'object' &&
        exception !== null &&
        'message' in exception &&
        typeof (exception as { message?: unknown }).message === 'string'
          ? (exception as { message: string }).message
          : 'Bad Gateway';
    }

    // 2) Xây payload theo helper của bạn
    const payload = Response.error(
      Array.isArray(message) ? message.join(', ') : message,
      status,
      reason,
      null,
    );

    // 3) Trả về theo từng context
    const type = host.getType();
    if (type === 'http') {
      const ctx = host.switchToHttp();
      const res = ctx.getResponse<ExpressResponse>();
      return res.status(status).json(payload);
    }

    // Với RPC/WebSocket hoặc các context khác, trả object để Nest tự serialize
    return payload;
  }
}
