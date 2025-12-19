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
    },
  });

  Utils.createKafkaMicroserviceFromApplication(app, SERVICES.AI);

  await app.startAllMicroservices();
  await app.init();

  console.log(`🔥 AI service gRPC listening on ${HOST}:${PORT}`);
}

void bootstrap();
