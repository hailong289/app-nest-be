import { SERVICES } from '@app/constants';
import { Module, DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, KafkaOptions, Transport } from '@nestjs/microservices';

@Module({})
export class KafkaModule {
  static register(serviceName: string): DynamicModule {
    const clientRegistration = ClientsModule.registerAsync([
      {
        name: serviceName,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const client_id = config.get('kafka.client_id');
          const host = config.get('kafka.host');
          const port = config.get('kafka.port');
          const group_id = config.get('kafka.group_id');
          const isSasl = config.get('kafka.is_sasl');
          const mechanism = config.get('kafka.mechanism');
          const username = config.get('kafka.username');
          const password = config.get('kafka.password');

          const options: KafkaOptions['options'] = {
            client: {
              clientId: client_id,
              brokers: [`${host}:${port}`],
            },
            consumer: {
              groupId: group_id,
            },
          };

          if (isSasl) {
            options.client = {
              ...options.client,
              ssl: false,
              sasl: {
                mechanism: mechanism,
                username: username,
                password: password,
              },
              brokers: options.client?.brokers || [`${host}:${port}`],
            };
          }

          console.log('options kafka', options);
          return {
            transport: Transport.KAFKA,
            options,
          };
        },
      },
    ]);

    return {
      module: KafkaModule,
      imports: [clientRegistration],
      providers: [],
      exports: [clientRegistration],
    };
  }
}
