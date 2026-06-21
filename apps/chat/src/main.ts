import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { Logger } from '@nestjs/common';
import Utils from '@app/helpers/utils';

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
      channelOptions: {
        'grpc.keepalive_time_ms': 60000,
        'grpc.keepalive_timeout_ms': 10000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.http2.min_time_between_pings_ms': 60000,
        'grpc.http2.min_ping_interval_without_data_ms': 10000,
      },
    },
  });

  // Kafka consumer cho chat: tự consume MESSAGE_PERSISTED để chạy "tail" tạo
  // tin nhắn (state/unread/notification) bất đồng bộ, không chặn create path.
  Utils.createKafkaMicroserviceFromApplication(app, 'chat');

  try {
    await app.startAllMicroservices();
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`❌ Microservice bind FAILED: ${msg}`);
    if (/EADDRINUSE/i.test(msg)) {
      console.error(
        '   → Port đã bị chiếm. Dọn process cũ: `yarn clean:ports` (pkill -f "nest start"), rồi chạy lại.',
      );
    }
    console.error(
      '   → gRPC sẽ KHÔNG phục vụ (gateway nhận ECONNREFUSED). Thoát process.',
    );
    await app.close().catch(() => {});
    process.exit(1);
  }

  await app.init();

  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`chat gRPC + Kafka microservice is listening on port ${process.env.PORT}`);
}
void bootstrap();
