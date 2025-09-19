import { Controller, Get, Post, Body, Inject, UseInterceptors, UploadedFile, UploadedFiles, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { GatewayService } from './gateway.service';
import { firstValueFrom } from 'rxjs';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

@Controller()
export class GatewayController {

  constructor(
    private readonly gatewayService: GatewayService,
    @Inject('AUTH_SERVICE') private readonly authClient: ClientProxy,
    @Inject('CHAT_SERVICE') private readonly chatClient: ClientProxy,
    @Inject('NOTIFICATION_SERVICE') private readonly notificationClient: ClientProxy,
    @Inject('FILESYSTEM_SERVICE') private readonly filesystemClient: ClientProxy,
  ) {}

  

  @Get()
  getHealth() {
    return this.gatewayService.getHealth();
  }

  // Auth endpoints
  @Post('auth/login')
  async login(@Body() loginDto: any) {
     return await firstValueFrom(this.authClient.send('login', loginDto));
  }

  @Post('auth/register')
  async register(@Body() registerDto: any) {
    return await firstValueFrom(this.authClient.send('register', registerDto));
  }

  // Chat endpoints
  @Get('chat/messages')
  @Get('chat/messages')
  async getMessages() {
    try {
      return await firstValueFrom(this.chatClient.send('get_messages', {}));
    } catch (error) {
      console.error('Get messages error:', error);
      return { success: false, message: 'Chat service unavailable' };
    }
  }

  @Post('chat/send')
  async sendMessage(@Body() messageDto: any) {
    try {
      return await firstValueFrom(this.chatClient.send('send_message', messageDto));
    } catch (error) {
      console.error('Send message error:', error);
      return { success: false, message: 'Chat service unavailable' };
    }
  }

  // Notification endpoints
  @Post('notifications/welcome')
  async sendWelcomeEmail(@Body() user: { email: string; name: string }) {
    try {
      return await firstValueFrom(this.notificationClient.send('send_welcome_email', user));
    } catch (error) {
      console.error('Send welcome email error:', error);
      return { success: false, message: 'Notification service unavailable' };
    }
  }

  @Post('notifications/push')
  async sendPushNotification(@Body() notification: {
    tokens: string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }) {
    try {
      return await firstValueFrom(this.notificationClient.send('send_push_notification', notification));
    } catch (error) {
      console.error('Send push notification error:', error);
      return { success: false, message: 'Notification service unavailable' };
    }
  }

  // Filesystem endpoints
  @Post('filesystem/upload-single')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingleFile(@UploadedFile() file: any, @Body('folder') folder: string) {
    try {
      const fileData = {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        folder: folder || 'uploads',
      };
      return await firstValueFrom(this.filesystemClient.send('upload_single_file', fileData));
    } catch (error) {
      console.error('Upload single file error:', error);
      return { success: false, message: 'Filesystem service unavailable' };
    }
  }

  @Post('filesystem/upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultipleFiles(@UploadedFiles() files: any[], @Body('folder') folder: string) {
    try {
      const filesData = {
        files: files.map(file => ({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        })),
        folder: folder || 'uploads',
      };
      return await firstValueFrom(this.filesystemClient.send('upload_multiple_files', filesData));
    } catch (error) {
      console.error('Upload multiple files error:', error);
      return { success: false, message: 'Filesystem service unavailable' };
    }
  }

  @Post('filesystem/delete')
  async deleteFile(@Body() data: { fileName: string; folder?: string }) {
    try {
      return await firstValueFrom(this.filesystemClient.send('delete_file', data));
    } catch (error) {
      console.error('Delete file error:', error);
      return { success: false, message: 'Filesystem service unavailable' };
    }
  }

  @Get('filesystem/presigned-url')
  async getPresignedUrl(@Query('fileName') fileName: string) {
    try {
      return await firstValueFrom(this.filesystemClient.send('get_presigned_url', { fileName }));
    } catch (error) {
      console.error('Get presigned URL error:', error);
      return { success: false, message: 'Filesystem service unavailable' };
    }
  }
}