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
        return new BadRequestException({
          statusCode: 400,
          message: errors.map((err) => ({
            field: err.property,
            errors: Object.values(err.constraints ?? {}),
          })),
          reasonStatusCode: 'BAD_REQUEST',
        });
      },
    }),
  );
  useSharedRedisAdapter(app);
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

bootstrap();
