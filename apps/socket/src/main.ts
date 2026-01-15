import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { useSharedRedisAdapter } from 'libs/ws/src';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await useSharedRedisAdapter(app);
  console.log('Socket is running on port', process.env.PORT || 5006);
  await app.listen(process.env.PORT || 5006);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    `Socket is running on: http://localhost:${process.env.PORT || 5006}`,
  );
}

void bootstrap();
