import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { AiModule } from './ai.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AiModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'ai',
        protoPath: join(
          process.cwd(),
          process.env.PROTO_URL || 'libs/grpc/ai.proto',
        ),
        url: `${process.env.HOST}:${process.env.PORT}`,
      },
    },
  );

  app.useGlobalFilters(new HttpExceptionsFilter());
  await app.listen();
  console.log(`AI gRPC microservice is listening on port ${process.env.PORT}`);
}

bootstrap();
