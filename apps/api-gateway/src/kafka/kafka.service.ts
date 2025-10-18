import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';

@Injectable()
export class KafkaService implements OnModuleInit {
  private readonly logger = new Logger(KafkaService.name);

  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly filesystemClient: ClientKafka,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connectLater();
  }

  private async connectLater(): Promise<void> {
    try {
      await Promise.all([
        this.filesystemClient.connect(),
        this.notificationClient.connect(),
      ]);
      this.logger.log('✅ Kafka clients connected (filesystem & notification)');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        'Kafka connect failed, retrying in 5s...',
        errorMessage,
      );
      setTimeout(() => {
        void this.connectLater();
      }, 5000);
    }
  }

  getClients() {
    return {
      filesystem: this.filesystemClient,
      notification: this.notificationClient,
    };
  }
}
