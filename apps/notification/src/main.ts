import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import Utils from '@app/helpers/utils';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { SERVICES } from '@app/constants';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  // const app = await Utils.createKafkaMicroservice(AppModule, 'notification');
  // await app.listen();
  // console.log('Notification microservice is listening on Kafka broker');
  const app = await NestFactory.create(AppModule);
  const HOST = process.env.HOST || '0.0.0.0';
  const PORT = process.env.PORT || 5005;
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'notification',
      protoPath: [join(process.cwd(), 'libs/grpc/notification.proto')],
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
  Utils.createKafkaMicroserviceFromApplication(app, 'notification');
  const logger = new Logger();
  app.useGlobalFilters(new HttpExceptionsFilter());

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', error.message);
    console.log('Some microservices may not be available, but continuing...');
  }

  await app.init();
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`notification gRPC microservice is listening on port ${PORT}`);
}

bootstrap();
