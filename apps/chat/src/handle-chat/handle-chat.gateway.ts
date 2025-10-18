// import { WebSocketGateway } from '@nestjs/websockets';
import { HandleChatService } from './handle-chat.service';

// @WebSocketGateway()
export class HandleChatGateway {
  constructor(private readonly handleChatService: HandleChatService) {}
}
