import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '../interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors();

  app.useGlobalInterceptors(new ResponseInterceptor());
  
  // Global prefix
  app.setGlobalPrefix('api');
  console.log('Global prefix set to /api', process.env.PORT || 5000);
  await app.listen(process.env.PORT || 5000);
  console.log(`API Gateway is running on: http://localhost:${process.env.PORT || 5000}`);
}

bootstrap();