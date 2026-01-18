import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { useSharedRedisAdapter } from 'libs/ws/src';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*', // Hoặc origin cụ thể
    credentials: true,
  });
  await useSharedRedisAdapter(app);
  console.log('Socket is running on port', process.env.PORT || 5006);
  // Lắng nghe trên 0.0.0.0 để tránh vấn đề IPv4/IPv6 trên Windows
  await app.listen(process.env.PORT || 5006, '0.0.0.0');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    `Socket is running on: http://localhost:${process.env.PORT || 5006}`,
  );
}

void bootstrap();
