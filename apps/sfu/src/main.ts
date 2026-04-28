import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SharedSecretInterceptor } from './auth/shared-secret.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('SfuBootstrap');

  app.useGlobalInterceptors(new SharedSecretInterceptor());

  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.PORT || '5007';

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['sfu'],
      protoPath: [join(process.cwd(), 'libs/grpc/sfu.proto')],
      url: `${host}:${port}`,
      loader: {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [join(process.cwd(), 'libs/grpc')],
      },
    },
  });

  await app.startAllMicroservices();
  await app.init();

  logger.log(`SFU gRPC microservice listening on ${host}:${port}`);
  logger.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`MEDIASOUP_ANNOUNCED_IP: ${process.env.MEDIASOUP_ANNOUNCED_IP}`);
}
void bootstrap();
