import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import Utils from '@app/helpers/utils';
import { SERVICES } from '@app/constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const HOST = process.env.HOST || 'localhost';
  const PORT = process.env.PORT || 5002;
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['filesystem', 'document'],
      protoPath: [
        join(process.cwd(), 'libs/grpc/filesystem.proto'),
        join(process.cwd(), 'libs/grpc/document.proto'),
      ],
      url: `${HOST}:${PORT}`,
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
  });
  Utils.createKafkaMicroserviceFromApplication(app, SERVICES.FILESYSTEM);
  const logger = new Logger();
  app.useGlobalFilters(new HttpExceptionsFilter());

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', (error as Error).message);
    console.log('Some microservices may not be available, but continuing...');
  }

  await app.init();
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`file gRPC microservice is listening on port ${PORT}`);
}

void bootstrap();
