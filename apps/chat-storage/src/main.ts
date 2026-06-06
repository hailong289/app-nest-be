import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * Bootstrap chat-storage (write-behind consumer).
 *
 * Consumer Kafka tự start ở `MessageStoreConsumer.onModuleInit` (raw kafkajs
 * eachBatch, at-least-once — xem libs/kafka startBulkBatchConsumer). Ta mở một
 * HTTP server tối thiểu (health) vì Cloud Run yêu cầu container lắng nghe trên
 * `$PORT` để qua startup probe. Xem deploy-chat-storage.yml.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');
  new Logger('chat-storage').log(
    `chat-storage write-behind consumer up — health on :${port} (NODE_ENV=${
      process.env.NODE_ENV || 'development'
    })`,
  );
}
void bootstrap();
