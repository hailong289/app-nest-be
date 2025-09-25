import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { HttpExceptionsFilter } from './errors/http-exception-filter.error';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'auth-service',
        brokers: ['localhost:9092'],
      },
      consumer: {
        groupId: 'auth-consumer',
      },
    },
  });

  app.useGlobalFilters(new HttpExceptionsFilter())
  await app.listen();
  console.log('Auth microservice is listening on port 3001');
}

bootstrap();