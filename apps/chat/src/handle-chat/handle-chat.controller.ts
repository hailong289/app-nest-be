import { Body, Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HandleChatService } from './handle-chat.service';
import { CreateMessage, GetMsgFromRoomDTO, markReadUpToDto } from '@app/dto';

@Controller('handle-chat')
export class HandleChatController {
  private readonly logger = new Logger(HandleChatController.name);

  constructor(private readonly hdChat: HandleChatService) {}

  @GrpcMethod('ChatService', 'CreateNewMsg')
  async NewMsg(@Body() payload: CreateMessage) {
    const result = await this.hdChat.createMessage(payload);
    // console.log('🚀 ~ HandleChatController ~ NewMsg ~ result:', result);
    return result;
  }

  @GrpcMethod('ChatService', 'GetOneMsg')
  async GetOneMsg(@Body() payload: { userId: string; msgId: string }) {
    this.logger.log('[gRPC] GetOneMsg called with payload:', payload);
    const result = await this.hdChat.getOneMsg(payload.userId, payload.msgId);
    // console.log('🚀 ~ HandleChatController ~ GetOneMsg ~ result:', result);
    return result;
  }
  @GrpcMethod('ChatService', 'MarkReadUpTo')
  async MarkReadUpTo(@Body() payload: markReadUpToDto) {
    const result = await this.hdChat.markReadUpTo(payload);
    return result;
  }
  @GrpcMethod('ChatService', 'GetMsgFromRoom')
  async GetMsgFromRoom(@Body() payload: GetMsgFromRoomDTO) {
    const result = await this.hdChat.getMsgFromRoom(payload);
    // console.log('🚀 ~ HandleChatController ~ GetMsgFromRoom ~ result:', result);
    return result;
  }
}
