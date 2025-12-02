import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'filesystem',
        protoPath: join(
          process.cwd(),
          process.env.PROTO_URL || 'libs/grpc/filesystem.proto',
        ),
        url: `${process.env.HOST}:${process.env.PORT}`,
        maxReceiveMessageLength: 500 * 1024 * 1024, // 20MB
        maxSendMessageLength: 500 * 1024 * 1024,
      },
    },
  );

  await app.listen();
  console.log(
    `Filesystem microservice is listening on port ${process.env.PORT}`,
  );
}

bootstrap();
