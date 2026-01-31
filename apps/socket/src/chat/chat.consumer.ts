import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { ChatGateway } from './chat-gateway';
import { Logger } from '@nestjs/common';

@Processor('room_updates')
export class ChatConsumer {
  private readonly logger = new Logger(ChatConsumer.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @Process('refresh')
  handleRoomRefresh(job: Job<{ roomId: string }>) {
    this.logger.log(`Processing room refresh for roomId: ${job.data.roomId}`);
    this.chatGateway.emitRoomRefresh(job.data.roomId);
  }
}
