import { Body, Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HandleChatService } from './handle-chat.service';
import { CreateMessage } from '@app/dto';

@Controller('handle-chat')
export class HandleChatController {
  private readonly logger = new Logger(HandleChatController.name);

  constructor(private readonly hdChat: HandleChatService) {}

  @GrpcMethod('ChatService', 'CreateNewMsg')
  async NewMsg(@Body() payload: CreateMessage) {
    this.logger.log('[gRPC] CreateNewMsg called with payload:', payload);
    try {
      const result = await this.hdChat.createMessage(payload);
      this.logger.log('[gRPC] CreateNewMsg success:', result);
      return result;
    } catch (error) {
      this.logger.error('[gRPC] CreateNewMsg error:', error);
      throw error;
    }
  }

  @GrpcMethod('ChatService', 'GetOneMsg')
  async GetOneMsg(@Body() payload: { userId: string; msgId: string }) {
    this.logger.log('[gRPC] GetOneMsg called with payload:', payload);
    return this.hdChat.getOneMsg(payload.userId, payload.msgId);
  }
}
