import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { socketEvent } from '@app/dto/enum.type';
import { Observable } from 'rxjs';
import Utils from 'libs/helpers/src/utils';
import { PresenceService } from '../ws/presence.service';
import type { JwtPayload, SocketWithUser } from '../ws/socket-user.types';

interface DocumentMetadata {
  _id: string;
  ownerId: string;
  title: string;
  roomId: string;
  yjsSnapshot?: Uint8Array;
  plainText?: string;
  visibility: string;
  sharedWith?: Array<{ userId: string; role: string }>;
  attachmentIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface GrpcResponse {
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata?: DocumentMetadata | DocumentMetadata[];
}

interface DocumentService {
  CreateDoc(data: any): Observable<any>;
  GetDoc(data: any): Observable<any>;
  UpdateDoc(data: any): Observable<any>;
  DeleteDoc(data: any): Observable<any>;
  ListDocs(data: any): Observable<any>;
}
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/doc',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class DocGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() io!: Server;
  private readonly logger = new Logger(DocGateway.name);
  private readonly key = REDISKEY;
  private DocGrpcService!: DocumentService;

  constructor(
    @Inject(SERVICES.FILESYSTEM) private readonly docClient: ClientGrpc,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit() {
    this.DocGrpcService =
      this.docClient.getService<DocumentService>('DocumentService');
  }

  // ========================================================
  // Connection Handling
  // ========================================================
  async handleConnection(client: SocketWithUser) {
    try {
      let token: string | undefined =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization as string);

      if (!token) {
        this.logger.warn(
          `[CONNECT] No token provided from client ${client.id}`,
        );
        client.emit('error', { message: 'No token provided' });
        client.emit('exception', {
          status: 'error',
          message: 'Xác thực không thành công - Token không được cung cấp',
        });
        client.disconnect();
        return;
      }

      // Loại bỏ "Bearer " prefix
      if (token.startsWith('Bearer ')) {
        token = token.replace('Bearer ', '');
      }

      const jwtSecret = this.configService.get<string>(
        'GATEWAY_JWT_ACCESS_SECRET',
      );

      if (!jwtSecret) {
        this.logger.error('[CONNECT] JWT secret not configured');
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: jwtSecret,
      });

      // Check JTI in Redis
      if (payload.jti && payload._id) {
        const redisResult: string | number | boolean | null =
          await this.redis.getData(
            this.key.REFRESH_TOKEN(payload._id, payload.jti),
          );
        const isValid =
          typeof redisResult === 'string' ||
          typeof redisResult === 'number' ||
          typeof redisResult === 'boolean'
            ? Boolean(redisResult)
            : !!redisResult;

        if (!isValid) {
          this.logger.warn(
            `[CONNECT] Token revoked or expired for user ${payload._id}`,
          );
          client.emit('exception', {
            status: 'error',
            message: 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi',
          });
          client.disconnect();
          return;
        }
      }

      // Check User Status
      if (payload.usr_status && payload.usr_status !== 'active') {
        this.logger.warn(
          `[CONNECT] User ${payload._id} is not active (status: ${payload.usr_status})`,
        );
        client.emit('exception', {
          status: 'error',
          message: 'Tài khoản hiện không hoạt động',
        });
        client.disconnect();
        return;
      }

      // tham gia vào các room của hệ thống
      await client.join([this.key.ROOM_CLIENT(payload.usr_id), 'system']);
      client.userId = payload._id;
      client.user = payload;

      // Delegate presence tracking to PresenceService — keyed by usr_id,
      // namespace "doc". Broadcasts STATUS only when this is the user's
      // first live socket across all namespaces (chat / call / doc).
      await this.presence.register('doc', client.id, payload.usr_id);

      this.logger.log(
        `[DOC-CONNECT] User ${payload.usr_fullname} (${payload._id}) connected.`,
      );
      const roomIds = await this.redis.sMembers(
        this.key.USER_ROOMS(client.userId),
      );
      await client.join(roomIds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[DOC-CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );

      // Emit error event explicitly to debug
      client.emit('error', {
        message: `DocGateway Auth Failed: ${errorMessage}`,
        code: 401,
      });

      client.emit(socketEvent.VERYFIỄPTION, {
        status: 'error',
        statusCode: 401,
        message: 'Mã xác thực không hợp lệ hoặc đã hết hạn',
      });
      client.disconnect();
    }
  }

  async handleDisconnect(client: SocketWithUser) {
    const usrId = client.user?.usr_id;
    if (!client.userId || !usrId) return;
    this.logger.log(
      `[DOC-DISCONNECT] User ${client.user?.usr_fullname} (${client.userId}) disconnected`,
    );
    await this.presence.unregister('doc', client.id, usrId);
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: SocketWithUser) {
    if (!client.user?.usr_id) return;
    await this.presence.heartbeat('doc', client.id, client.user.usr_id);
  }
  private async getUser(@ConnectedSocket() client: SocketWithUser) {
    if (!client.user) {
      try {
        let token: string | undefined =
          (client.handshake.auth?.token as string) ||
          (client.handshake.query?.token as string) ||
          (client.handshake.headers?.authorization as string);

        if (token) {
          if (token.startsWith('Bearer ')) {
            token = token.replace('Bearer ', '');
          }
          const jwtSecret = this.configService.get<string>(
            'GATEWAY_JWT_ACCESS_SECRET',
          );
          if (jwtSecret) {
            const payload = this.jwtService.verify<JwtPayload>(token, {
              secret: jwtSecret,
            });
            if (payload.jti && payload._id) {
              const redisResult: unknown = await this.redis.getData(
                this.key.REFRESH_TOKEN(payload._id, payload.jti),
              );
              const isValid =
                typeof redisResult === 'string' ||
                typeof redisResult === 'number' ||
                typeof redisResult === 'boolean'
                  ? Boolean(redisResult)
                  : !!redisResult;

              if (isValid) {
                client.user = payload;
                client.userId = payload._id;
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `[getUser] Re-auth failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const user = client.user;
    if (!user) {
      throw new Error('Unauthorized');
    }
    return user;
  }
  // ========================================================
  // Document Events
  // ========================================================
  @SubscribeMessage('doc:open')
  async onDocumentOpen(
    @MessageBody() data: { docId: string; userId?: string },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    const { docId } = data;
    data.userId = user._id;

    try {
      this.logger.log(
        `[DOC-OPEN] User ${user.usr_fullname} opening document ${docId}`,
      );

      // Join document room
      const docRoom = `doc:${docId}`;
      await client.join(docRoom);

      // Get document from service
      const result = (await Utils.dispatchGrpcRequest(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument
        (this.DocGrpcService.GetDoc as any).bind(this.DocGrpcService),
        { docId, userId: user._id },
      )) as GrpcResponse;

      // Notify others in room
      client.to(docRoom).emit('user:joined', {
        userId: user.usr_id,
        fullname: user.usr_fullname,
        avatar: user.usr_avatar,
      });
      const response = { ok: true, document: result?.metadata };
      client.emit('doc:opened', { ...result?.metadata });
      return response;
    } catch (error) {
      this.logger.error('[DOC-OPEN] Error:', error);
      client.emit('error', {
        message: 'Mở tài liệu thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false };
    }
  }

  // ========================================================
  // 🚀 FAST LANE: Real-time Updates (Incremental)
  // ========================================================
  // Sự kiện này chưa có trong code cũ của bạn -> Bắt buộc thêm
  @SubscribeMessage('doc:broadcast')
  async onDocumentBroadcast(
    @MessageBody() data: { docId: string; yjsUpdate: number[] }, // Nhận array number từ client
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return;
    }

    const { docId, yjsUpdate } = data;
    const docRoom = `doc:${docId}`;

    // 🔥 QUAN TRỌNG: Chỉ Relay (chuyền bóng) ngay lập tức
    // Không lưu DB, không giải mã, không logic phức tạp
    // Gửi cho TẤT CẢ mọi người trong phòng TRỪ người gửi (client.to)
    client.to(docRoom).emit('doc:broadcasted', {
      yjsUpdate,
      userId: user.usr_id,
      clientId: client.id,
    });
  }

  // ========================================================
  // 🐢 HEAVY LANE: Persistence (Full Snapshot / Plain Text)
  // ========================================================
  @SubscribeMessage('doc:change')
  async onDocumentChange(
    @MessageBody()
    data: {
      docId: string;
      yjsSnapshot?: number[]; // Lưu ý: Client gửi mảng số qua JSON
      plainText?: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      return { ok: false };
    }

    // Convert array number sang Uint8Array/Buffer để gRPC hoặc Service xử lý
    const yjsBuffer =
      data.yjsSnapshot && data.yjsSnapshot.length > 0
        ? Buffer.from(data.yjsSnapshot)
        : undefined;
    const { docId, plainText } = data;

    try {
      this.logger.debug(
        `[DOC-SAVE] User ${user.usr_fullname} saving snapshot for ${docId}. Size: ${yjsBuffer?.length ?? 0} bytes`,
      );

      // Gọi Service để lưu vào DB (Logic nặng)
      (await Utils.dispatchGrpcRequest(
        this.DocGrpcService.UpdateDoc.bind(this.DocGrpcService),
        {
          docId,
          yjsSnapshot: yjsBuffer, // Truyền Buffer
          plainText,
          userId: user._id,
        },
      )) as GrpcResponse;

      // ⚠️ Tinh chỉnh Broadcast lại sau khi lưu:
      // Client đã có dữ liệu rồi (nhờ broadcast ở trên),
      // sự kiện này chủ yếu để xác nhận dữ liệu đã an toàn trong DB (Consistency)
      // Hoặc để sync lại nếu có merge conflict từ server.

      const docRoom = `doc:${docId}`;
      client.to(docRoom).emit('doc:changed', {
        // Chỉ gửi lại snapshot nếu cần thiết (optional để tiết kiệm băng thông)
        // Nếu Server có merge logic xịn, gửi lại snapshot là tốt nhất.
        yjsSnapshot: data.yjsSnapshot,
        userId: user.usr_id,
        clientId: client.id,
        updatedAt: new Date(),
      });

      return { ok: true };
    } catch (error) {
      this.logger.error('[DOC-SAVE] Error:', error);
      client.emit('error', { message: 'Lưu thất bại' });
      return { ok: false };
    }
  }

  @SubscribeMessage('doc:cursor')
  async onCursorMove(
    @MessageBody()
    data: {
      docId: string;
      cursorPosition: Record<string, unknown>;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return;
    }

    const { docId, cursorPosition } = data;
    const docRoom = `doc:${docId}`;

    // Broadcast cursor position to others
    client.to(docRoom).emit('user:cursor', {
      userId: user.usr_id,
      fullname: user.usr_fullname,
      avatar: user.usr_avatar,
      cursorPosition,
      color: this.getUserColor(user.usr_id),
    });
  }

  @SubscribeMessage('doc:typing')
  async onUserTyping(
    @MessageBody()
    data: {
      docId: string;
      isTyping: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return;
    }

    const { docId, isTyping } = data;
    const docRoom = `doc:${docId}`;

    client.to(docRoom).emit('user:typing', {
      userId: user.usr_id,
      fullname: user.usr_fullname,
      isTyping,
    });
  }

  @SubscribeMessage('doc:close')
  async onDocumentClose(
    @MessageBody() data: { docId: string },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return;
    }

    const { docId } = data;
    const docRoom = `doc:${docId}`;

    this.logger.log(
      `[DOC-CLOSE] User ${user.usr_fullname} closing document ${docId}`,
    );

    client.to(docRoom).emit('user:left', {
      userId: user.usr_id,
      fullname: user.usr_fullname,
    });

    await client.leave(docRoom);
  }
  @SubscribeMessage('doc:awareness')
  async onAwarenessUpdate(
    @MessageBody()
    data: {
      docId: string;
      awareness: [number, Record<string, any>][];
      changed: { added: number[]; updated: number[]; removed: number[] };
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    let user: JwtPayload;
    try {
      user = await this.getUser(client);
    } catch {
      return;
    }

    const { docId, awareness, changed } = data;
    const docRoom = `doc:${docId}`;

    // Broadcast awareness to others
    client.to(docRoom).emit('doc:awareness', {
      awareness,
      changed,
      userId: user.usr_id,
    });
  }
  // ========================================================
  // Helpers
  // ========================================================
  private getUserColor(userId: string): string {
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#FFA07A',
      '#98D8C8',
      '#F7DC6F',
      '#BB8FCE',
      '#85C1E2',
    ];
    const hash = userId
      .split('')
      .reduce((acc, char) => acc + (char.codePointAt(0) ?? 0), 0);
    return colors[hash % colors.length];
  }
}
