import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger();
  app.useGlobalFilters(new HttpExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['chat', 'social'],
      protoPath: [
        join(process.cwd(), 'libs/grpc/chat.proto'),
        join(process.cwd(), 'libs/grpc/social.proto'),
      ],
      url: `${process.env.HOST}:${process.env.PORT}`,
      loader: {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [join(process.cwd(), 'libs/grpc')],
      },
    },
  });

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', (error as Error).message);
    console.log('Some microservices may not be available, but continuing...');
  }

  await app.init();

  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`chat gRPC microservice is listening on port ${process.env.PORT}`);
}
void bootstrap();
