import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

interface RedisConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
}

@Module({})
export class SharedBullModule {
  static registerAsync(configKey: string = 'redis'): DynamicModule {
    return BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.get<RedisConfig>(configKey);
        if (!redisConfig) {
          throw new Error(`Redis config not found for key: ${configKey}`);
        }
        return {
          redis: {
            host: redisConfig.host,
            port: redisConfig.port,
            username: redisConfig.username,
            password: redisConfig.password,
            db: redisConfig.db,
          },
        };
      },
      inject: [ConfigService],
    });
  }

  static registerQueue(name: string): DynamicModule {
    return BullModule.registerQueue({
      name,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
}
