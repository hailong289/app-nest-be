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
    return result;
  }

  @GrpcMethod('ChatService', 'GetOneMsg')
  async GetOneMsg(@Body() payload: { userId: string; msgId: string }) {
    this.logger.log('[gRPC] GetOneMsg called with payload:', payload);
    const result = await this.hdChat.getOneMsg(payload.userId, payload.msgId);
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
    return result;
  }
  @GrpcMethod('ChatService', 'HandleDelete')
  async HandleDelete(@Body() payload: HandleDeleteAllDto) {
    const result = await this.hdChat.handleDelete(payload);
    return result;
  }

  @GrpcMethod('ChatService', 'RequestCall')
  async RequestCall(
    @Body()
    payload: {
      actionUserId: string; // Người bắt đầu cuộc gọi
      membersIds: string[]; // ID các thành viên trong cuộc gọi
      roomId: string; // ID phòng gọi
      callType: 'video' | 'audio'; // Loại cuộc gọi
      messageId: string; // ID tin nhắn cuộc gọi
    },
  ) {
    const result = await this.hdChat.requestCall(payload);
    return result;
  }

  @GrpcMethod('ChatService', 'AcceptCall')
  async AcceptCall(
    @Body()
    payload: {
      actionUserId: string;
      membersIds: string[];
      roomId: string;
    },
  ) {
    const result = await this.hdChat.acceptCall(payload);
    return result;
  }

  @GrpcMethod('ChatService', 'EndCall')
  async EndCall(
    @Body()
    payload: {
      actionUserId: string; // Người gọi hoặc người nhận cuộc gọi
      roomId: string; // ID phòng gọi
      status: 'ended' | 'missed' | 'rejected' | 'cancelled'; // Trạng thái cuộc gọi
    },
  ) {
    const result = await this.hdChat.endCall(payload);
    return result;
  }

  @GrpcMethod('ChatService', 'GetCallHistory')
  async GetCallHistory(
    @Body()
    payload: {
      userId: string; // ID người dùng
      roomId: string; // ID phòng gọi
      type: 'caller' | 'callee'; // Loại lịch sử cuộc gọi
    },
  ) {
    const result = await this.hdChat.getCallHistoryByUserId(
      payload.userId,
      payload.roomId,
      payload.type,
    );
    return result;
  }

  @GrpcMethod('ChatService', 'GetDocumentsFromRoom')
  async GetDocumentsFromRoom(@Body() payload: GetDocumentsFromRoomDTO) {
    const result = await this.hdChat.getDocumentsFromRoom(payload);
    return result;
  }
}
