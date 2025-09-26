import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { HttpExceptionsFilter } from './errors/http-exception-filter.error';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: 'auth',
      protoPath: join(__dirname, process.env.PROTO_URL || '../../../libs/grpc/auth.proto'),
      url: `${process.env.HOST || 'localhost'}:${process.env.PORT || '3001'}`,
    },
  });

  app.useGlobalFilters(new HttpExceptionsFilter());
  await app.listen();
  console.log(`Auth gRPC microservice is listening on port ${process.env.PORT || 3001}`);
}

bootstrap();