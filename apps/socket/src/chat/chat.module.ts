import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat-gateway';
import { OnlineStatusTask } from '../tasks/online-status.task';

@Module({
  imports: [
    ConfigModule, // WsJwtGuard cần ConfigService
    JwtModule.register({}), // WsJwtGuard cần JwtService
  ],
  controllers: [],
  providers: [ChatGateway, OnlineStatusTask],
  exports: [ChatGateway],
})
export class ChatWebSocketModule {}
