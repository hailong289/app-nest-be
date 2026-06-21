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
  const port = process.env.PORT || '5008';

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

  try {
    await app.startAllMicroservices();
  } catch (error) {
    const msg = (error as Error).message;
    logger.error(`❌ SFU microservice bind FAILED: ${msg}`);
    if (/EADDRINUSE/i.test(msg)) {
      logger.error(
        '   → Port đã bị chiếm. Dọn process cũ: `yarn clean:ports` (pkill -f "nest start"), rồi chạy lại.',
      );
    }
    await app.close().catch(() => {});
    process.exit(1);
  }
  await app.init();

  logger.log(`SFU gRPC microservice listening on ${host}:${port}`);
  logger.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  logger.log(`MEDIASOUP_ANNOUNCED_IP: ${process.env.MEDIASOUP_ANNOUNCED_IP}`);
}
void bootstrap();
