import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  BadRequestException,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CallHistory, CallStatus, RedisService, Room } from 'libs/db/src';
import { REDISKEY, REDIS_TTL } from '@app/constants/RedisKey';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { socketEvent } from 'libs/dto/src/enum.type';
import Utils from 'libs/helpers/src/utils';
import { SfuRpcClient, UnifiedSignalHandler } from '@app/sfu';

interface JwtPayload {
  _id: string; // MongoDB _id: "68ff5ede5903ab252a84b117"
  usr_fullname: string; // "Lê Thiên Trí"
  usr_email: string; // "thientrile2003@gmail.com"
  usr_phone?: string;
  usr_avatar?: string;
  usr_gender?: string;
  usr_status?: string;
  usr_id: string; // User ID
  usr_slug: string;
  usr_dateOfBirth?: string;
  createdAt?: string;
  updatedAt?: string;
  jti: string;
  [key: string]: any;
}

interface SocketWithUser extends Socket {
  userId?: string; // MongoDB _id
  user?: JwtPayload; // Full user payload
}

export interface ChatGrpcService {
  CreateNewMsg<T = any>(data: T): Observable<any>;
  getRoom<T = any>(data: T): Observable<any>;
  GetOneMsg<T = any>(data: T): Observable<any>;
  MarkReadUpTo<T = any>(data: T): Observable<any>;
  HandleReact<T = any>(data: T): Observable<any>;
  HandlePinned<T = any>(data: T): Observable<any>;
  HandleDeleteForUser<T = any>(data: T): Observable<any>;
  HandleDelete<T = any>(data: T): Observable<any>;
  RequestCall<T = any>(data: T): Observable<any>;
  AcceptCall<T = any>(data: T): Observable<any>;
  EndCall<T = any>(data: T): Observable<any>;
  SendCandidate<T = any>(data: T): Observable<any>;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/call',
  // Thêm 2 dòng dưới đây để Server chấp nhận mọi loại kết nối
  transports: ['websocket', 'polling'],
  allowEIO3: true, // Cho phép tương thích ngược với các client đời cũ (nếu có)
})
export class CallGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() io!: Server;
  public get server(): Server {
    return this.io;
  }
  private readonly logger = new Logger(CallGateway.name);
  private readonly key = REDISKEY;
  private ChatGrpcService!: ChatGrpcService;
  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly unifiedSignalHandler: UnifiedSignalHandler,
    private readonly sfuRpc: SfuRpcClient,
  ) {}
  onModuleInit() {
    this.ChatGrpcService =
      this.chatClient.getService<ChatGrpcService>('ChatService');
  }

  /**
   * Mark `client.id` as THE active call socket for this user. If a different
   * socket of the same user was already in the call (other device, other
   * tab), tell it to gracefully release the call (close popup, clear state).
   * Returns the previous socketId if a handoff happened, otherwise null.
   *
   * Used by every entry point into a call: caller (call:request), callee
   * (call:accepted), late joiner (call:join). Ensures single-active-device.
   */
  private async claimCallSocket(
    userUlid: string,
    callId: string,
    roomId: string,
    newSocketId: string,
  ): Promise<string | null> {
    const previousSocketId = await this.redis.getData<string>(
      this.key.USER_CALL_SOCKET(userUlid),
    );

    await this.redis.setData(
      this.key.USER_CALL_SOCKET(userUlid),
      newSocketId,
      REDIS_TTL.CALL_ACTIVE,
    );

    if (previousSocketId && previousSocketId !== newSocketId) {
      // Notify the old device to release the call. FE handler closes the
      // popup window and tears down its local stream / SFU consumers.
      this.io.to(previousSocketId).emit('call:handoff', {
        callId,
        roomId,
        reason: 'another_device_joined',
        newSocketId,
      });

      // Server-side cleanup: drop the old socket from the SFU room so its
      // transports/producers don't linger until ICE timeout.
      try {
        if (await this.sfuRpc.roomExists(roomId)) {
          await this.sfuRpc.leaveRoom(roomId, userUlid);
          this.logger.log(
            `[HANDOFF] SFU cleanup for ${userUlid} (old socket ${previousSocketId})`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[HANDOFF] SFU leaveRoom failed for ${userUlid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      this.logger.log(
        `[HANDOFF] User ${userUlid} call ${callId} → handed off ${previousSocketId} → ${newSocketId}`,
      );
      return previousSocketId;
    }

    return null;
  }

  // ========================================================
  // 🟢 HÀM XỬ LÝ KẾT NỐI (HANDLING CONNECTION)
  // ========================================================
  async handleConnection(client: SocketWithUser) {
    // Xác thực JWT trong handleConnection
    try {
      // Lấy token từ nhiều nguồn
      let token: string | undefined =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization as string);

      if (!token) {
        this.logger.warn(
          `[CONNECT] No token provided from client ${client.id}`,
        );
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

      // tham gia vào các room của hệ thống
      await client.join([this.key.ROOM_CLIENT(payload.usr_id), 'system']);
      client.userId = payload._id;
      // Track socket id for this user (SET)
      await this.redis.sAdd(this.key.USER_ONLINE(client.userId), client.id);

      // Track user online status (String with TTL)
      // Value = ISO timestamp of when they came online or last refreshed
      await this.redis.setData(
        this.key.USER_PRESENCE(client.userId),
        new Date().toISOString(),
        REDIS_TTL.ONLINE_STATUS + 15, // buffer time
      );
      // Heartbeat Queue for Cron cleanliness
      await this.redis.zAdd(
        this.key.USERS_HEARTBEAT,
        Date.now(),
        client.userId,
      );

      await this.redis.setData(
        this.key.USER_LAST_SEEN(client.userId),
        new Date().toISOString(),
      );

      // Gắn user info vào socket
      client.user = payload;

      this.logger.log(
        `[CONNECT] User call ${payload.usr_fullname} (${payload._id}) connected.`,
      );
      const roomIds = await this.redis.sMembers(
        this.key.USER_ROOMS(client.userId),
      );
      await client.join(roomIds);
      // Gửi thông báo đến người dùng
      this.io.to('system').emit(socketEvent.STATUS, {
        id: client.user.usr_id,
        isOnline: true,
        onlineAt: new Date(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit(socketEvent.VERYFIỄPTION, {
        status: 'error',
        statusCode: 401,
        message: 'Mã xác thực không hợp lệ hoặc đã hết hạn',
      });
      client.disconnect();
    }
  }

  // ========================================================
  // 🔴 HÀM XỬ LÝ NGẮT KẾT NỐI (HANDLING DISCONNECT)
  // ========================================================
  async handleDisconnect(client: SocketWithUser) {
    const userId = client.userId;
    const fullname = client.user?.usr_fullname;

    // Use scheduler to handle "true" offline after timeout,
    // BUT we can update the timestamp or remove if we want immediate offline effect
    // For now, let's just remove the specific socket ID from the user's socket track

    // Luôn kiểm tra user vì socket có thể disconnect vì lý do mạng,
    // hoặc client bị ngắt trước khi Guard kịp chạy.
    if (userId) {
      this.logger.log(
        `[DISCONNECT] User ${fullname} (${userId}) disconnected.`,
      );

      await this.redis.sRem(this.key.USER_ONLINE(userId), client.id);
      const checkOnline = await this.redis.sCard(this.key.USER_ONLINE(userId));

      // Clean up SFU participant for all rooms this socket was in.
      // Without this, the server-side transports/producers linger until ICE timeout.
      const userUlid = client.user?.usr_id;
      if (userUlid) {
        for (const socketRoom of client.rooms) {
          if (socketRoom === client.id) continue;
          try {
            if (await this.sfuRpc.roomExists(socketRoom)) {
              await this.sfuRpc.leaveRoom(socketRoom, userUlid);
              this.logger.log(
                `[DISCONNECT] Cleaned up SFU participant ${userUlid} from room ${socketRoom}`,
              );
            }
          } catch (err) {
            this.logger.warn(
              `[DISCONNECT] SFU cleanup failed for ${userUlid} in ${socketRoom}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }

        // If the user was in an active call, mark their participation as ended
        // in the CallHistory (chat service) so DB stays consistent + notify
        // remaining members so their UI removes the leaver. Without this, the
        // member's status sits at 'started' forever and the call never ends
        // server-side until everyone manually clicks End.
        try {
          const activeCallId = await this.redis.getData<string>(
            this.key.USER_IN_CALL(userUlid),
          );
          if (activeCallId) {
            // Pick the socket room that hosts the SFU session (or any joined
            // room as fallback for P2P 1-1) — that's the room we end on behalf
            // of this user.
            let endRoomId: string | null = null;
            for (const socketRoom of client.rooms) {
              if (socketRoom === client.id) continue;
              if (socketRoom === 'system') continue;
              if (socketRoom.startsWith('client:')) continue; // ROOM_CLIENT(usr_id)
              endRoomId = socketRoom;
              break;
            }

            if (endRoomId) {
              // 1. Update CallHistory in DB via gRPC. status='ended' lets the
              //    chat service compute member.status correctly (ended for
              //    leavers; ended_at when caller leaves or all members ended).
              const endResult = (await Utils.dispatchGrpcRequest(
                (d) => this.ChatGrpcService.EndCall(d),
                {
                  actionUserId: userUlid,
                  roomId: endRoomId,
                  callId: activeCallId,
                  status: 'ended',
                },
              )) as ChatGatewayCallResponse;

              // 2. Notify remaining members in the room.
              const members = endResult?.metadata?.history?.members ?? [];
              this.io.to(endRoomId).except(client.id).emit('call:end', {
                roomId: endRoomId,
                actionUserId: userUlid,
                callId: activeCallId,
                status: 'ended',
                members,
                reason: 'disconnect',
              });

              this.logger.log(
                `[DISCONNECT] Updated CallHistory + emitted call:end for ${userUlid} in ${endRoomId}`,
              );
            }

            // 3. Always clear the in-call flag + active call socket so
            //    reconnects don't show stale "busy" and handoff state resets.
            await this.redis.delKey(this.key.USER_IN_CALL(userUlid));
            // Only clear the call_socket key if THIS socket was the active
            // one — otherwise we'd wipe out a handoff to another device.
            const activeSocketId = await this.redis.getData<string>(
              this.key.USER_CALL_SOCKET(userUlid),
            );
            if (!activeSocketId || activeSocketId === client.id) {
              await this.redis.delKey(this.key.USER_CALL_SOCKET(userUlid));
            }
          }
        } catch (err) {
          this.logger.error(
            `[DISCONNECT] Failed to update call state for ${userUlid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Nếu không còn socket nào của user này connected -> Remove presence
      if (checkOnline == 0) {
        await this.redis.delKey(this.key.USER_PRESENCE(userId));
        await this.redis.zRem(this.key.USERS_HEARTBEAT, userId);

        this.io.to('system').emit(socketEvent.STATUS, {
          id: client.user?.usr_id, // Use usr_id (string) for frontend consistency
          isOnline: false,
          lastSeen: new Date(),
        });
        this.io.emit('system', `${fullname} went offline.`);
      }
    }
  }

  // ========================================================
  //  CALL HANDLERS
  // ========================================================

  @SubscribeMessage('call:request')
  async handleCallRequest(
    @MessageBody()
    data: {
      actionUserId?: string;
      membersIds?: string[];
      roomId: string;
      callType: 'video' | 'audio';
      messageId?: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      // ─── Server-side guard 1: caller already in another call ─────────────
      // Trust Redis as the source of truth — client state can drift (stale
      // popup window, crashed tab, multi-device). Reject before creating any
      // CallHistory so DB stays clean.
      const callerActiveCallId = await this.redis.getData<string>(
        this.key.USER_IN_CALL(user.usr_id),
      );
      if (callerActiveCallId) {
        this.logger.warn(
          `[CALL] Reject request: caller ${user.usr_id} already in call ${callerActiveCallId}`,
        );
        client.emit('error', {
          message: 'Bạn đang trong cuộc gọi khác, không thể bắt đầu cuộc gọi mới',
          error: 'caller_already_in_call',
          callId: callerActiveCallId,
        });
        return { ok: false, reason: 'caller_already_in_call' };
      }

      const memberIds = data.membersIds ?? [];
      const targetIds = memberIds.filter((id) => id !== user.usr_id);

      // ─── Server-side guard 2: 1-1 — target busy → instant reject ─────────
      if (targetIds.length === 1) {
        const targetUserId = targetIds[0];
        const busyCallId = await this.redis.getData<string>(
          this.key.USER_IN_CALL(targetUserId),
        );
        if (busyCallId) {
          client.emit('call:busy', {
            targetUserId,
            callId: busyCallId,
            reason: 'busy',
          });
          return { ok: false, reason: 'busy' };
        }
      }

      // ─── Server-side guard 3: group call — pre-compute busy/free targets ──
      // Allow the call to proceed even if some members are busy (other members
      // can still join), but track busy ones so we don't spam them with
      // call:request and so the caller's UI can flag them.
      const busyTargets = new Map<string, string>(); // userId → callId
      const freeTargets: string[] = [];
      if (targetIds.length > 1) {
        const busyKeys = targetIds.map((id) => this.key.USER_IN_CALL(id));
        const busyValues = await this.redis.mget(busyKeys);
        targetIds.forEach((id, i) => {
          const v = busyValues[i];
          if (v) busyTargets.set(id, typeof v === 'string' ? JSON.parse(v) : String(v));
          else freeTargets.push(id);
        });

        // If everyone is busy → abort to avoid an empty group call.
        if (freeTargets.length === 0) {
          client.emit('error', {
            message: 'Tất cả thành viên đang trong cuộc gọi khác',
            error: 'all_targets_busy',
            busyMembers: Array.from(busyTargets.keys()),
          });
          return { ok: false, reason: 'all_targets_busy' };
        }
      }

      // bắt đầu tạo lịch sử cuộc gọi
      const result = (await Utils.dispatchGrpcRequest(
        (d) => this.ChatGrpcService.RequestCall(d),
        data,
      )) as ChatGatewayCallResponse;

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Bắt đầu cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, callType, callMode, msg } = result.metadata;

      // Join the canonical socket room (room.room_id) so SFU normalization works correctly.
      // data.roomId may be a MongoDB ObjectId while room.room_id is the custom ULID.
      await client.join(room.room_id);
      if (data.roomId !== room.room_id) {
        client.leave(data.roomId);
      }

      // Mark caller as in-call in Redis (TTL = max call duration safety net)
      await this.redis.setData(
        this.key.USER_IN_CALL(user.usr_id),
        history.call_id,
        REDIS_TTL.CALL_ACTIVE,
      );

      // Multi-device handoff: claim this socket as the active call socket
      // (caller starts call from this device → other devices auto-release).
      await this.claimCallSocket(
        user.usr_id,
        history.call_id,
        room.room_id,
        client.id,
      );

      // Skip members already busy in another call — they're tracked in
      // busyTargets from guard 3 above. Send call:request only to free
      // members. Busy members are reported back to the caller so the FE can
      // mark them with a "đang bận" badge.
      const otherMembers = room.room_members
        .filter((m) => m.id !== user.usr_id && !busyTargets.has(m.id))
        .map((m) => this.key.ROOM_CLIENT(m.id));
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );

      const historyCall = {
        members: history.members,
        roomId: room.room_id,
        actionUserId: user.usr_id,
        callType: callType,
        callMode: callMode,
        callId: history.call_id,
        startedAt: history.started_at,
      };
      this.io.to(otherMembers).emit('call:request', historyCall);
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      return {
        ok: true,
        room: { room_id: room.room_id },
        startedAt: history.started_at,
        busyMembers: Array.from(busyTargets.entries()).map(
          ([userId, callId]) => ({ userId, callId }),
        ),
      };
    } catch (error) {
      this.logger.error('[CALL] Error starting call:', error);
      client.emit('error', {
        message: 'Bắt đầu cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:busy')
  async handleCallBusy(
    @MessageBody()
    data: {
      callId: string;
      callerUserId: string; // who to notify
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      // Forward the busy notification to the caller
      const callerRoom = this.key.ROOM_CLIENT(data.callerUserId);
      this.io.to(callerRoom).emit('call:busy', {
        targetUserId: user.usr_id,
        callId: data.callId,
        reason: 'busy',
      });
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error forwarding busy:', error);
      return { ok: false };
    }
  }

  @SubscribeMessage(socketEvent.USERSATUS)
  async handleCheckUserStatus(
    @MessageBody() userIds: string[],
    @ConnectedSocket() client: SocketWithUser,
  ) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) return;
    try {
      // Optimized: Check presence keys using MGET
      const keys = userIds.map((uid) => this.key.USER_PRESENCE(uid));
      const results = await this.redis.mget(keys);

      results.forEach((val, index) => {
        if (val) {
          // val is the ISO string we stored
          const date = new Date(JSON.parse(val));
          if (!isNaN(date.getTime())) {
            client.emit(socketEvent.STATUS, {
              id: userIds[index],
              isOnline: true,
              onlineAt: date,
            });
          }
        }
      });
    } catch (error) {
      this.logger.error('[CALL] Error checking user status:', error);
    }
  }

  @SubscribeMessage('call:accepted')
  async handleAccept(
    @MessageBody()
    data: {
      actionUserId?: string;
      membersIds?: string[];
      roomId: string;
      offer: string;
      targetUserId: string;
      callId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      // Deduplicate: ignore duplicate call:accepted from same user for same call
      // (caused by socket reconnects re-triggering the frontend useEffect)
      const acceptLockKey = `call:accept:lock:${data.callId}:${data.actionUserId}`;
      const alreadyAccepted: string | null =
        await this.redis.getData(acceptLockKey);
      if (alreadyAccepted) {
        return { ok: true };
      }

      // Server-side guard: reject accept ONLY if user is in a DIFFERENT
      // active call. Same callId is allowed — could be a multi-device
      // accept (handoff handled below).
      const inCallId = await this.redis.getData<string>(
        this.key.USER_IN_CALL(data.actionUserId),
      );
      if (inCallId && inCallId !== data.callId) {
        this.logger.warn(
          `[CALL] Reject accept: user ${data.actionUserId} already in call ${inCallId}`,
        );
        client.emit('error', {
          message: 'Bạn đang trong cuộc gọi khác',
          error: 'already_in_call',
          callId: inCallId,
        });
        return { ok: false, reason: 'already_in_call' };
      }

      await this.redis.setData(acceptLockKey, '1', REDIS_TTL.CALL_ACTIVE);

      // Multi-device handoff: if another socket of the same user already
      // holds this call, tell that socket to release. New socket takes over.
      await this.claimCallSocket(
        data.actionUserId,
        data.callId,
        data.roomId,
        client.id,
      );

      // Người nhận tham gia socket room để nhận các sự kiện call:end, call:share-screen, v.v.
      await client.join(data.roomId);
      // trả lời cuộc gọi qua gRPC và tạo lịch sử cuộc gọi
      const result = (await Utils.dispatchGrpcRequest(
        (d) => this.ChatGrpcService.AcceptCall(d),
        {
          actionUserId: data.actionUserId,
          membersIds: data.membersIds,
          roomId: data.roomId,
          callId: data.callId,
        },
      )) as ChatGatewayCallResponse;
      console.log('🚀 ~ ChatGateway ~ handleAccept ~ result:', result);

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Trả lời cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg, callMode } = result.metadata;

      // Mark callee as in-call
      if (!data.actionUserId) {
        throw new Error('actionUserId is required');
      }
      const actionUserId = String(data.actionUserId);
      await this.redis.setData(
        this.key.USER_IN_CALL(actionUserId),
        data.callId,
        REDIS_TTL.CALL_ACTIVE,
      );

      if (callMode === 'sfu') {
        // SFU calls: the callee should be routing through call:join which already emits
        // call:member-joined.  But if the callee sent call:accepted first (e.g. due to a
        // race condition where callMode wasn't set yet on FE), handle it gracefully here
        // by emitting call:member-joined so the caller transitions from "calling" → "accepted".
        this.io.to(room.room_id).except(client.id).emit('call:member-joined', {
          members: history.members,
          roomId: room.room_id,
          actionUserId: data.actionUserId,
          callId: data.callId,
        });
      } else {
        // P2P calls: forward the offer to the caller.
        const targetSocketId = this.key.ROOM_CLIENT(data.targetUserId);
        this.io.to(targetSocketId).emit('call:accepted', {
          members: history.members,
          roomId: room.room_id,
          actionUserId: data.actionUserId,
          offer: data.offer,
          history: history,
          callId: data.callId,
        });
      }
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error accept call:', error);
      client.emit('error', {
        message: 'Trả lời cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:answer')
  async handleAnswer(
    @MessageBody()
    data: {
      actionUserId?: string;
      targetUserId: string;
      roomId: string;
      answer: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      const targetSocketId = this.key.ROOM_CLIENT(data.targetUserId);
      // this.io.to(data.roomId).except(client.id).emit('call:answer', data);
      this.io.to(targetSocketId).emit('call:answer', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error answering call:', error);
      client.emit('error', {
        message: 'Trả lời cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================
  // � JOIN LATER HANDLER (tham gia cuộc gọi đang diễn ra)
  // ========================================================
  @SubscribeMessage('call:join')
  async handleJoinCall(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      callId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      // Server-side guard: reject join ONLY if user is in a DIFFERENT call.
      // Same callId is allowed (multi-device join → handoff).
      const inCallId = await this.redis.getData<string>(
        this.key.USER_IN_CALL(data.actionUserId),
      );
      if (inCallId && inCallId !== data.callId) {
        this.logger.warn(
          `[CALL] Reject join: user ${data.actionUserId} already in call ${inCallId}`,
        );
        client.emit('error', {
          message: 'Bạn đang trong cuộc gọi khác',
          error: 'already_in_call',
          callId: inCallId,
        });
        return { ok: false, reason: 'already_in_call' };
      }

      // Multi-device handoff: claim this socket as the active call socket.
      // Old device's popup auto-closes via `call:handoff` event.
      await this.claimCallSocket(
        data.actionUserId,
        data.callId,
        data.roomId,
        client.id,
      );

      // Cập nhật trạng thái thành viên sang 'started' qua gRPC
      const result = (await Utils.dispatchGrpcRequest(
        (d) => this.ChatGrpcService.AcceptCall(d),
        {
          actionUserId: data.actionUserId,
          roomId: data.roomId,
          callId: data.callId,
        },
      )) as ChatGatewayCallResponse;

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Tham gia cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg } = result.metadata;

      // Tham gia socket room bằng canonical room_id (room.room_id) để đồng bộ với các client khác.
      // data.roomId có thể là MongoDB ObjectId (từ msg.roomId ở FE), còn room.room_id là custom string.
      await client.join(room.room_id);
      if (data.roomId !== room.room_id) {
        client.leave(data.roomId);
      }

      // Mark joiner as in-call
      await this.redis.setData(
        this.key.USER_IN_CALL(data.actionUserId),
        data.callId,
        REDIS_TTL.CALL_ACTIVE,
      );

      // Thông báo cho tất cả thành viên trong phòng về thành viên mới tham gia
      this.io.to(room.room_id).except(client.id).emit('call:member-joined', {
        members: history.members,
        roomId: room.room_id,
        actionUserId: data.actionUserId,
        callId: data.callId,
      });

      // Cập nhật tin nhắn cuộc gọi cho tất cả thành viên
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      return { ok: true, history, room };
    } catch (error) {
      this.logger.error('[CALL] Error joining call:', error);
      client.emit('error', {
        message: 'Tham gia cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================
  // �🔥 UNIFIED SIGNAL HANDLER (P2P + SFU)
  // ========================================================
  @SubscribeMessage('signal')
  async handleSignal(
    @MessageBody() payload: any,
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      // Delegate to UnifiedSignalHandler with server instance
      return await this.unifiedSignalHandler.handleSignal(
        payload,
        client,
        this.server,
      );
    } catch (error) {
      this.logger.error(`[SIGNAL] Error:`, error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================
  // 🟢 LEGACY CALL HANDLERS (P2P)
  // ========================================================
  @SubscribeMessage('call:end')
  async handleEnd(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      status: CallStatus;
      callId: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      // kết thúc cuộc gọi qua gRPC và tạo lịch sử cuộc gọi
      const result = (await Utils.dispatchGrpcRequest(
        (d) => this.ChatGrpcService.EndCall(d),
        data,
      )) as ChatGatewayCallResponse;

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Kết thúc cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg } = result.metadata;

      // Clear in-call status + active call socket for all members when call ends
      if (history?.members) {
        await Promise.all(
          history.members.flatMap((m: { id: string }) => [
            this.redis.delKey(this.key.USER_IN_CALL(m.id)),
            this.redis.delKey(this.key.USER_CALL_SOCKET(m.id)),
          ]),
        );
      }

      // Use client.to() (not this.io.to()) so the broadcast excludes the sender.
      // this.io.to() would echo call:end back to the caller, causing their
      // beforeunload handler to fire and re-emit call:end again.
      client.to(data.roomId).emit('call:end', {
        members: history.members,
        roomId: room.room_id,
        actionUserId: data.actionUserId,
        status: data.status,
        history: history,
        callId: data.callId,
      });
      const roomClients = room.room_members.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
      this.io.to(roomClients).emit(socketEvent.MSGUPSERT, msg);

      // await this.pushMessageToRoom(
      //   room.room_id,
      //   history.message_id?.toString() ?? '',
      //   history.members,
      //   history,
      // );

      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error ending call:', error);
      client.emit('error', {
        message: 'Kết thúc cuộc gọi thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @SubscribeMessage('call:share-screen')
  async handleShareScreen(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      isSharing: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      this.io.to(data.roomId).except(client.id).emit('call:share-screen', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error sharing screen:', error);
      client.emit('error', {
        message: 'Chia sẻ màn hình thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==== candidate
  @SubscribeMessage('call:candidate')
  async handleCandidate(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      candidate: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      this.io.to(data.roomId).except(client.id).emit('call:candidate', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error sending candidate:', error);
      client.emit('error', {
        message: 'Gửi candidate thất bại',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
}

interface ChatGatewayCallResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    history: CallHistory;
    room: Room;
    callType: string;
    callMode?: string;
    msg: Record<string, any>;
  };
}
