import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { HttpExceptionsFilter } from './errors/http-exception-filter.error';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'chat',
        protoPath: join(
          process.cwd(),
          process.env.PROTO_URL || 'libs/grpc/chat.proto',
        ),
        url: `${process.env.HOST}:${process.env.PORT}`,
      },
    },
  );

  app.useGlobalFilters(new HttpExceptionsFilter());
  await app.listen();
  console.log(
    `chat gRPC microservice is listening on port ${process.env.PORT}`,
  );
}
void bootstrap();
