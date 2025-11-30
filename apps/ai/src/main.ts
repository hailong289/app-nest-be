import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log(
    `Environment: HOST=${process.env.HOST}, PORT=${process.env.PORT}`,
  );
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
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
