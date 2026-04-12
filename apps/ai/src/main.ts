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

  app.useGlobalFilters(new HttpExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['ai', 'quizz', 'flashcard'],
      protoPath: [join(process.cwd(), 'libs/grpc/ai.proto')],
      url: `${HOST}:${PORT}`,
      maxReceiveMessageLength: 500 * 1024 * 1024, // 500MB
      maxSendMessageLength: 500 * 1024 * 1024, // 500MB
      loader: {
        keepCase: true, // 👈 BẮT BUỘC PHẢI CÓ Ở ĐÂY NỮA!
        includeDirs: [join(process.cwd(), 'libs/grpc')],
      },
      channelOptions: {
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.http2.min_time_between_pings_ms': 10000,
        'grpc.http2.min_ping_interval_without_data_ms': 5000,
      },
    },
  });

  Utils.createKafkaMicroserviceFromApplication(app, SERVICES.AI);

  try {
    await app.startAllMicroservices();
  } catch (error) {
    console.error('Error starting microservices:', (error as Error).message);
    console.log('Some microservices may not be available, but continuing...');
  }
  await app.init();

  console.log(`🔥 AI service gRPC listening on ${HOST}:${PORT}`);
}

void bootstrap();
