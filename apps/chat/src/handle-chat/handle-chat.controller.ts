import { Body, Controller, Logger } from '@nestjs/common';
import { GrpcMethod, MessagePattern, Payload } from '@nestjs/microservices';
import { HandleChatService } from './handle-chat.service';
import {
  CreateMessage,
  GetMsgFromRoomDTO,
  HandleDeleteAllDto,
  HandleDeleteDto,
  HandlePinDto,
  HandleReactDto,
  markReadUpToDto,
} from '@app/dto';
import { KafkaEvent } from '@app/dto/enum.type';
import { ChangeFeedService } from '../change-feed/change-feed.service';
import type { OutboxAppendPayload } from '../change-feed/change-feed.service';

@Controller('handle-chat')
export class HandleChatController {
  private readonly logger = new Logger(HandleChatController.name);

  constructor(
    private readonly hdChat: HandleChatService,
    private readonly changeFeed: ChangeFeedService,
  ) {}

  @GrpcMethod('ChatService', 'CreateNewMsg')
  async NewMsg(@Body() payload: CreateMessage) {
    const result = await this.hdChat.createMessage(payload);
    return result;
  }

  /**
   * Consumer "tail" tạo tin nhắn (chat tự emit + tự consume). Chạy cập nhật
   * RoomsState/MessageRead/unread + emit downstream BẤT ĐỒNG BỘ, không chặn
   * create path. Lỗi ở đây không ảnh hưởng việc tạo tin (đã commit + emit realtime).
   */
  @MessagePattern(KafkaEvent.MESSAGE_PERSISTED)
  async onMessagePersisted(
    @Payload()
    data: Parameters<HandleChatService['handleMessagePersisted']>[0],
  ) {
    try {
      await this.hdChat.handleMessagePersisted(data);
    } catch (err) {
      this.logger.error(
        `[MESSAGE_PERSISTED] tail failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Consumer ghi outbox change-feed (catch-up sync). Tách khỏi mutation path:
   * `emit()` chỉ INCR seq + dispatch, việc bulkWrite per-recipient chạy ở đây.
   * Lỗi không ảnh hưởng mutation gốc (đã commit + emit realtime).
   */
  @MessagePattern(KafkaEvent.OUTBOX_APPEND)
  async onOutboxAppend(@Payload() data: OutboxAppendPayload) {
    try {
      await this.changeFeed.handleOutboxAppend(data);
    } catch (err) {
      this.logger.error(
        `[OUTBOX_APPEND] write failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * AI vừa tóm tắt xong file đính kèm. Re-fetch message (pipeline đã join
   * summary mới) rồi broadcast MSGUPSERT để FE cập nhật bong bóng realtime.
   */
  @MessagePattern(KafkaEvent.FILE_SUMMARY_READY)
  async onFileSummaryReady(@Payload() data: { messageId: string }) {
    try {
      await this.hdChat.broadcastFileSummary(data.messageId);
    } catch (err) {
      this.logger.error(
        `[FILE_SUMMARY_READY] broadcast failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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

  /** Pull change-feed catch-up (outbox per-user) kể từ con trỏ sinceSeq. */
  @GrpcMethod('ChatService', 'SyncEvents')
  async SyncEvents(
    @Body() payload: { userId: string; sinceSeq?: number; limit?: number },
  ) {
    return this.changeFeed.syncEvents(payload);
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
      callId: string;
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
      callId: string;
    },
  ) {
    const result = await this.hdChat.endCall(payload);
    return result;
  }

  @GrpcMethod('ChatService', 'GetCallStatus')
  async GetCallStatus(@Body() payload: { callId: string }) {
    const result = await this.hdChat.getCallStatus(payload);
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
}
