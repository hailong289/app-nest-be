import { Global, Module } from '@nestjs/common';
import { SERVICES } from '@app/constants/services';
import { GrpcClientModule } from 'libs/grpc/grpc-client.module';
import { RemoteEmitterModule } from 'libs/ws/src';
import { AiTranslationClient } from './ai-translation.client';
import { CallTranscriptionService } from './call-transcription.service';
import { ChatTranscriptClient } from './chat-transcript.client';
import { WhisperRunnerService } from './whisper-runner.service';

@Global()
@Module({
  imports: [
    RemoteEmitterModule,
    GrpcClientModule.registerAsync({
      name: SERVICES.AI,
      configKey: 'ai',
      packages: ['ai'],
    }),
    GrpcClientModule.registerAsync({
      name: SERVICES.CHAT,
      configKey: 'chat',
      packages: ['chat', 'social'],
    }),
  ],
  providers: [
    AiTranslationClient,
    ChatTranscriptClient,
    WhisperRunnerService,
    CallTranscriptionService,
  ],
  exports: [CallTranscriptionService, WhisperRunnerService],
})
export class CallTranscriptionModule {}
