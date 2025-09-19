import { Injectable } from '@nestjs/common';

export interface Message {
  id: number;
  roomId: number;
  userId: number;
  content: string;
  timestamp: Date;
  userName: string;
}

export interface Room {
  id: number;
  name: string;
  description: string;
  createdBy: number;
  participants: number[];
  createdAt: Date;
}

@Injectable()
export class ChatService {
  private messages: Message[] = [
    {
      id: 1,
      roomId: 1,
      userId: 1,
      content: 'Hello everyone!',
      timestamp: new Date('2025-09-19T10:00:00Z'),
      userName: 'Admin User',
    },
    {
      id: 2,
      roomId: 1,
      userId: 2,
      content: 'Hi there!',
      timestamp: new Date('2025-09-19T10:01:00Z'),
      userName: 'Regular User',
    },
  ];

  private rooms: Room[] = [
    {
      id: 1,
      name: 'General',
      description: 'General discussion room',
      createdBy: 1,
      participants: [1, 2],
      createdAt: new Date('2025-09-19T09:00:00Z'),
    },
    {
      id: 2,
      name: 'Tech Talk',
      description: 'Technology discussions',
      createdBy: 1,
      participants: [1],
      createdAt: new Date('2025-09-19T09:30:00Z'),
    },
  ];

  async getMessages(roomId?: number) {
    if (roomId) {
      return {
        success: true,
        messages: this.messages.filter(m => m.roomId === roomId),
      };
    }

    return {
      success: true,
      messages: this.messages,
    };
  }

  async sendMessage(messageDto: { 
    roomId: number; 
    userId: number; 
    content: string; 
    userName: string; 
  }) {
    const newMessage: Message = {
      id: this.messages.length + 1,
      roomId: messageDto.roomId,
      userId: messageDto.userId,
      content: messageDto.content,
      timestamp: new Date(),
      userName: messageDto.userName,
    };

    this.messages.push(newMessage);

    return {
      success: true,
      message: 'Message sent successfully',
      data: newMessage,
    };
  }

  async getRooms(userId?: number) {
    if (userId) {
      return {
        success: true,
        rooms: this.rooms.filter(r => r.participants.includes(userId)),
      };
    }

    return {
      success: true,
      rooms: this.rooms,
    };
  }

  async createRoom(roomDto: { 
    name: string; 
    description: string; 
    createdBy: number; 
  }) {
    const newRoom: Room = {
      id: this.rooms.length + 1,
      name: roomDto.name,
      description: roomDto.description,
      createdBy: roomDto.createdBy,
      participants: [roomDto.createdBy],
      createdAt: new Date(),
    };

    this.rooms.push(newRoom);

    return {
      success: true,
      message: 'Room created successfully',
      data: newRoom,
    };
  }

  async joinRoom(roomId: number, userId: number) {
    const room = this.rooms.find(r => r.id === roomId);
    
    if (!room) {
      return {
        success: false,
        message: 'Room not found',
      };
    }

    if (room.participants.includes(userId)) {
      return {
        success: false,
        message: 'User already in room',
      };
    }

    room.participants.push(userId);

    return {
      success: true,
      message: 'Joined room successfully',
      data: room,
    };
  }
}