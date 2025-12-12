import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: ['filesystem', 'document'],
        protoPath: [
          join(process.cwd(), 'libs/grpc/filesystem.proto'),
          join(process.cwd(), 'libs/grpc/document.proto'),
        ],
        url: `${process.env.HOST}:${process.env.PORT}`,
        maxReceiveMessageLength: 500 * 1024 * 1024, // 20MB
        maxSendMessageLength: 500 * 1024 * 1024,
        loader: {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
          includeDirs: [join(process.cwd(), 'libs/grpc')],
        },
      },
    },
  );

  const logger = new Logger();
  app.useGlobalFilters(new HttpExceptionsFilter());
  await app.listen();
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`file gRPC microservice is listening on port ${process.env.PORT}`);
}

void bootstrap();
