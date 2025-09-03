import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull/dist/bull.module';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { NotificationController } from './notification.controller';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';

@Module({
    imports: [
        BullModule.forRootAsync({
            useFactory: (configService: ConfigService) => ({
                redis: configService.get('queue.redis'),
            }),
            inject: [ConfigService],
        }),
        BullModule.registerQueue({
            name: 'notification',
        })
    ],
    controllers: [NotificationController],
    providers: [
        FirebaseService,
        NotificationService,
        NotificationProcessor
    ],
    exports: [NotificationService],
})
export class NotificationModule { }