import { NestFactory } from '@nestjs/core';
import {
  KafkaOptions,
  MicroserviceOptions,
  Transport,
} from '@nestjs/microservices';
import { join } from 'path';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { AppModule } from './app.module';
import Utils from '@app/helpers/utils';
import { SERVICES } from '@app/constants/services';

async function bootstrap() {
  console.log(
    `Environment: HOST=${process.env.HOST}, PORT=${process.env.PORT}`,
  );

  // Tạo app
  const app = await NestFactory.create(AppModule);

  // 1. Kết nối GRPC
  await app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'ai',
      protoPath: join(
        process.cwd(),
        process.env.PROTO_URL || 'libs/grpc/ai.proto',
      ),
      url: `${process.env.HOST}:${process.env.PORT}`,
    },
  });

  // 2. Kết nối thêm Kafka
  await Utils.createKafkaMicroserviceFromApplication(app, SERVICES.AI);

  app.useGlobalFilters(new HttpExceptionsFilter());
  try {
    await app.startAllMicroservices();
    console.log('✅ Kafka & gRPC Consumers connected');
  } catch (error) {
    // Nếu Kafka chết, chỉ log lỗi chứ không crash app
    console.error(
      '⚠️ Kafka connection failed! Background jobs will not work.',
      error,
    );
    console.warn('⚠️ But gRPC server will still start...');
  }
  await app.listen(process.env.PORT || 5004);
  console.log(
    `AI microservice is listening on port ${process.env.PORT || 5004}`,
  );
}

bootstrap();
