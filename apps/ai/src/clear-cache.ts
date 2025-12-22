import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EmbeddingService } from './embedding.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const embeddingService = app.get(EmbeddingService);

  console.log('Clearing all embeddings...');
  const result = await embeddingService.clearAllEmbeddings();
  console.log('Result:', result);

  await app.close();
}

bootstrap();
