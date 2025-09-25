import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response } from 'libs/helpers/response';

@Catch()
export class HttpExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      return exception.getResponse();
    }

    // Các lỗi khác auto wrap format chuẩn
    return Response.error(
      exception.message || exception || 'Internal server error',
      exception.status || 500,
      exception.reasonStatusCode || 'INTERNAL_SERVER_ERROR',
      null
    );
  }
}
