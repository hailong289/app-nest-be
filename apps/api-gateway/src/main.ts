import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { useSharedRedisAdapter } from 'libs/ws/src';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: '*', // Hoặc origin cụ thể
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // loại bỏ field không khai báo trong DTO
      forbidNonWhitelisted: true, // ném lỗi nếu có field lạ
      transform: true,
      exceptionFactory: (errors) => {
        // Hàm recursive để thu thập tất cả lỗi từ children
        const mapErrors = (error: any, path = ''): any[] => {
          const fieldPath = path ? `${path}.${error.property}` : error.property;
          const result: any[] = [];

          // Thêm lỗi của chính field này
          if (error.constraints && Object.keys(error.constraints).length > 0) {
            result.push({
              field: fieldPath,
              errors: Object.values(error.constraints),
            });
          }

          // Xử lý children (nested errors)
          if (error.children && error.children.length > 0) {
            error.children.forEach((child: any) => {
              result.push(...mapErrors(child, fieldPath));
            });
          }

          return result;
        };

        const allErrors = errors.flatMap((err) => mapErrors(err));

        return new BadRequestException({
          statusCode: 400,
          message: allErrors,
          reasonStatusCode: 'BAD_REQUEST',
        });
      },
    }),
  );
  await useSharedRedisAdapter(app);
  app.useGlobalInterceptors(new ResponseInterceptor());
  // Global prefix
  app.setGlobalPrefix('api');
  console.log('Global prefix set to /api', process.env.PORT || 5000);
  await app.listen(process.env.PORT || 5000);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    `API Gateway is running on: http://localhost:${process.env.PORT || 5000}`,
  );
}

void bootstrap();
