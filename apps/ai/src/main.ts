import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import Utils from '@app/helpers/utils';
import { SERVICES } from '@app/constants/services';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const HOST = configService.get<string>('HOST') || '0.0.0.0';
  const PORT = configService.get<number>('PORT') || 5004;
  const PROTO_PATH =
    configService.get<string>('PROTO_URL') || 'libs/grpc/ai.proto';

  app.useGlobalFilters(new HttpExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['ai', 'quizz', 'flashcard'],
      protoPath: [
        join(process.cwd(), 'libs/grpc/ai.proto'),
        join(process.cwd(), 'libs/grpc/quizz.proto'),
        join(process.cwd(), 'libs/grpc/flashcard.proto'),
      ],
      url: `${HOST}:${PORT}`,
      maxReceiveMessageLength: 500 * 1024 * 1024, // 500MB
      maxSendMessageLength: 500 * 1024 * 1024, // 500MB
      loader: {
        keepCase: true, // 👈 BẮT BUỘC PHẢI CÓ Ở ĐÂY NỮA!
        includeDirs: [join(process.cwd(), 'libs/grpc')],
      },
    },
  });

  Utils.createKafkaMicroserviceFromApplication(app, SERVICES.AI);

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', error.message);
    console.log('Some microservices may not be available, but continuing...');
  }
  await app.init();

  console.log(`🔥 AI service gRPC listening on ${HOST}:${PORT}`);
}

void bootstrap();
