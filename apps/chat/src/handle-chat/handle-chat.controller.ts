import { Body, Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HandleChatService } from './handle-chat.service';
import {
  CreateMessage,
  GetDocumentsFromRoomDTO,
  GetMsgFromRoomDTO,
  HandleDeleteAllDto,
  HandleDeleteDto,
  HandlePinDto,
  HandleReactDto,
  markReadUpToDto,
} from '@app/dto';

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
  @GrpcMethod('ChatService', 'HandleReact')
  async HandlingReat(@Body() payload: HandleReactDto) {
    const result = await this.hdChat.handleReact(payload);
    return result;
  }
  @GrpcMethod('ChatService', 'HandlePinned')
  async HandlePinned(@Body() payload: HandlePinDto) {
    const result = await this.hdChat.handleGimMsg(payload);
    return result;
  }
  @GrpcMethod('ChatService', 'HandleDeleteForUser')
  async HandleDeleteForUser(@Body() payload: HandleDeleteDto) {
    const result = await this.hdChat.handleDeleteForUser(payload);
    // console.log(
    //   '🚀 ~ HandleChatController ~ HandleDeleteForUser ~ result:',
    //   result,
    // );
    return result;
  }
  @GrpcMethod('ChatService', 'HandleDelete')
  async HandleDelete(@Body() payload: HandleDeleteAllDto) {
    const result = await this.hdChat.handleDelete(payload);
    // console.log('🚀 ~ HandleChatController ~ HandleDelete ~ result:', result);
    return result;
  }

  @GrpcMethod('ChatService', 'GetDocumentsFromRoom')
  async GetDocumentsFromRoom(@Body() payload: GetDocumentsFromRoomDTO) {
    const result = await this.hdChat.getDocumentsFromRoom(payload);
    return result;
  }
}
