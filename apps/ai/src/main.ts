import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

import { AppModule } from './app.module';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import Utils from '@app/helpers/utils';
import { SERVICES } from '@app/constants/services';

async function bootstrap() {
  const HOST = process.env.HOST || '0.0.0.0';
  const PORT = Number(process.env.PORT) || 5004;
  const PROTO_PATH = process.env.PROTO_URL || 'libs/grpc/ai.proto';

  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'ai',
      protoPath: join(process.cwd(), PROTO_PATH),
      url: `${HOST}:${PORT}`,
      protoPath: join(
        process.cwd(),
        process.env.PROTO_URL || 'libs/grpc/ai.proto',
      ),
      url: `${process.env.HOST}:${process.env.PORT}`,
      maxReceiveMessageLength: 500 * 1024 * 1024, // 500MB
      maxSendMessageLength: 500 * 1024 * 1024, // 500MB
    },
  });

  Utils.createKafkaMicroserviceFromApplication(app, SERVICES.AI);

  await app.startAllMicroservices();
  await app.init();

  console.log(`🔥 AI service gRPC listening on ${HOST}:${PORT}`);
}

void bootstrap();
