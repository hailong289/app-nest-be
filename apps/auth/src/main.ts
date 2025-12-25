import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'auth',
      protoPath: join(
        process.cwd(),
        process.env.PROTO_URL || 'libs/grpc/auth.proto',
      ),
      url: `${process.env.HOST}:${process.env.PORT}`,
    },
  });

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', error.message);
    console.log('Some microservices may not be available, but continuing...');
  }

  await app.init();

  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    `Auth gRPC microservice is listening on port ${process.env.PORT}`,
  );
}

bootstrap();
