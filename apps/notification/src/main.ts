import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';


async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'notification-service',
        brokers: ['localhost:9092'], 
      },
      consumer: {
        groupId: 'notification-consumer',
      },
    },
  });

  await app.listen();
  console.log('Notification microservice is listening on port 3003');
}

bootstrap();