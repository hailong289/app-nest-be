import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { useSharedRedisAdapter } from './ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  await useSharedRedisAdapter(app);

  console.log('CWD:', process.cwd());
  console.log('NODE_ENV:', process.env.NODE_ENV);

  const port = process.env.PORT || 5006;
  console.log('Socket is running on port', port);

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
