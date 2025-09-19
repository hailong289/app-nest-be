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

export class CreateRoomDto {
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