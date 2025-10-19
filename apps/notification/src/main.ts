import { AppModule } from './app.module';
import Utils from '@app/helpers/utils';

async function bootstrap() {
  const app = await Utils.createKafkaMicroservice(AppModule, 'notification');
  await app.listen();
  console.log('Notification microservice is listening on Kafka broker');
}

bootstrap();
