import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @MessagePattern('get_messages')
  async getMessages(@Payload() data: any) {
    try {
      return await this.chatService.getMessages(data?.roomId);
    } catch (error) {
      console.error('Chat get messages error:', error);
      return { success: false, message: 'Get messages failed' };
    }
  }

  @MessagePattern('send_message')
  async sendMessage(@Payload() data: any) {
    try {
      if (!data || !data.roomId || !data.userId || !data.content) {
        return { success: false, message: 'Room ID, User ID and content are required' };
      }
      return await this.chatService.sendMessage(data);
    } catch (error) {
      console.error('Chat send message error:', error);
      return { success: false, message: 'Send message failed' };
    }
  }

  @MessagePattern('get_rooms')
  async getRooms(@Payload() data: any) {
    try {
      return await this.chatService.getRooms(data?.userId);
    } catch (error) {
      console.error('Chat get rooms error:', error);
      return { success: false, message: 'Get rooms failed' };
    }
  }

  @MessagePattern('create_room')
  async createRoom(@Payload() data: any) {
    try {
      if (!data || !data.name || !data.createdBy) {
        return { success: false, message: 'Room name and creator ID are required' };
      }
      return await this.chatService.createRoom(data);
    } catch (error) {
      console.error('Chat create room error:', error);
      return { success: false, message: 'Create room failed' };
    }
  }

  @MessagePattern('join_room')
  async joinRoom(@Payload() data: any) {
    try {
      if (!data || !data.roomId || !data.userId) {
        return { success: false, message: 'Room ID and User ID are required' };
      }
      return await this.chatService.joinRoom(data.roomId, data.userId);
    } catch (error) {
      console.error('Chat join room error:', error);
      return { success: false, message: 'Join room failed' };
    }
  }
}