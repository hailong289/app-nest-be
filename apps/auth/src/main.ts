import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';
import { HttpExceptionsFilter } from '@app/helpers/http-exception-filter.error';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'auth',
        protoPath: join(
          process.cwd(),
          process.env.PROTO_URL || 'libs/grpc/auth.proto',
        ),
        url: `${process.env.HOST}:${process.env.PORT}`,
      },
    },
  );

  app.useGlobalFilters(new HttpExceptionsFilter());
  await app.listen();
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    `Auth gRPC microservice is listening on port ${process.env.PORT}`,
  );
}

bootstrap();
