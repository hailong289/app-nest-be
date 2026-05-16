import { CallType, MsgType } from 'libs/db/src';

// Message DTOs
export class MessageDto {
  id: number;
  roomId: number;
  userId: number;
  content: string;
  timestamp: Date;
  userName: string;
}

export class SendMessageDto {
  roomId: number;
  userId: number;
  content: string;
  userName: string;
}

export class CreateMessageRoomDto {
  name: string;
  description: string;
  createdBy: number;
}

export class RoomDto {
  id: number;
  name: string;
  description: string;
  createdBy: number;
  participants: number[];
  createdAt: Date;
}

export class CreateMessage {
  id?: string;
  roomId: string;
  userId: string;
  type: MsgType;
  content: string | null;
  attachments?: string[]; // ✅ Optional array of strings
  replyTo: string | null;
  documentId?: string;
  quizId?: string;
  desk_id?: string;
  todoProjectId?: string;
  // pinned?: boolean;
}

export class markReadUpToDto {
  roomId: string;
  userId: string;
  lastMessageId: string;
}
export class GetMsgFromRoomDTO {
  roomId: string;
  userId: string;
  limit: number;
  type?: 'new' | 'old' | null;
  msgId?: string | null;
}
export class HandleReactDto {
  roomId: string;
  userId: string;
  msgId: string;
  emoji: string;
}
export class HandlePinDto {
  roomId: string;
  userId: string;
  msgId: string;
  pinned: boolean;
}
export class HandleDeleteDto {
  roomId: string;
  userId: string;
  msgId: string;
}
export class HandleDeleteAllDto {
  roomId: string;
  userId: string;
  msgId: string;
  placeholder: string;
}

export class GetDocumentsFromRoomDTO {
  roomId: string;
  userId: string;
  limit: number;
  page: number;
  type?: string;
}

export class RequestCallDto {
  actionUserId: string;
  membersIds: string[];
  roomId: string;
  callType: CallType;
}

export class AcceptCallDto {
  actionUserId: string;
  membersIds: string[];
  roomId: string;
  callId: string;
}

export class EndCallDto {
  actionUserId: string;
  roomId: string;
  status: 'ended' | 'missed' | 'rejected' | 'cancelled';
  callId: string;
}
