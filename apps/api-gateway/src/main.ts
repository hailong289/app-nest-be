import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import {
  ValidationPipe,
  BadRequestException,
  ValidationError,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust proxy headers — REQUIRED in production behind Cloud Run /
  // Cloudflare / NGINX / any reverse proxy. Without this, `req.ip`
  // returns the PROXY's IP (e.g. Google Front End edge node) instead
  // of the real client IP, breaking:
  //   - Device tracking (Keys model logs proxy IP not user's)
  //   - Rate limiting (everyone shares the same ip → false positives)
  //   - Geo-IP location lookup (returns CDN region not user region)
  //
  // `TRUST_PROXY_HOPS` (env): number of trusted proxy hops. Default
  // `true` means trust all `X-Forwarded-For` entries — fine for Cloud
  // Run since Google strips/sets the header at the edge. Set to `1`
  // when behind a single CDN you control, or to a comma-separated
  // list of CIDR ranges for stricter setups.
  const trustProxy = process.env.TRUST_PROXY_HOPS;
  app.set(
    'trust proxy',
    trustProxy === undefined
      ? true
      : /^\d+$/.test(trustProxy)
        ? parseInt(trustProxy, 10)
        : trustProxy,
  );

  // Parse Cookie header → req.cookies object. Required for the HttpOnly
  // `tokens` cookie set on login/refresh-token, which auth guards read
  // server-side instead of accepting Bearer tokens from the FE.
  app.use(cookieParser());

  // Enable CORS. `credentials: true` is REQUIRED so browsers send the
  // cookie on cross-origin requests (FE on a different domain). Origin
  // must NOT be '*' when credentials are sent — browsers reject that
  // combination. Use the FE origin from env (or list of allowed origins).
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // loại bỏ field không khai báo trong DTO
      forbidNonWhitelisted: true, // ném lỗi nếu có field lạ
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        // Hàm recursive để thu thập tất cả lỗi từ children
        const mapErrors = (
          error: ValidationError,
          path = '',
        ): { field: string; errors: string[] }[] => {
          const fieldPath = path ? `${path}.${error.property}` : error.property;
          const result: { field: string; errors: string[] }[] = [];

          // Thêm lỗi của chính field này
          if (error.constraints && Object.keys(error.constraints).length > 0) {
            result.push({
              field: fieldPath,
              errors: Object.values(error.constraints),
            });
          }

          // Xử lý children (nested errors)
          if (error.children && error.children.length > 0) {
            error.children.forEach((child: ValidationError) => {
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
