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
import { Server } from 'socket.io';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'libs/db/src/redis/redis.service';
import type { CallStatus } from 'libs/types';
import { REDISKEY, REDIS_TTL } from '@app/constants/RedisKey';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { socketEvent } from 'libs/dto/src/enum.type';
import Utils from 'libs/helpers/src/utils';
import { SfuRpcClient, UnifiedSignalHandler } from '@app/sfu';
import { PresenceService } from '../ws/presence.service';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  CALL_AUTO_MISS_QUEUE,
  type AutoMissJobData,
} from './call-auto-miss.constants';
import type { JwtPayload, SocketWithUser } from '../ws/socket-user.types';

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
  GetCallStatus<T = any>(data: T): Observable<any>;
  SendCandidate<T = any>(data: T): Observable<any>;
}

export interface AiGrpcService {
  TranscribeRealtime<T = any>(data: T): Observable<any>;
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
  private AiGrpcService!: AiGrpcService;
  constructor(
    @Inject(SERVICES.CHAT) private readonly chatClient: ClientGrpc,
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly unifiedSignalHandler: UnifiedSignalHandler,
    private readonly sfuRpc: SfuRpcClient,
    private readonly presence: PresenceService,
    // Bull queue for the server-side auto-miss timer. Bull persists the
    // job in Redis and applies a distributed lock so the 30s task
    // survives pod restarts and runs exactly once across multi-pod
    // deployments. Workers consume via `CallAutoMissProcessor`.
    @InjectQueue(CALL_AUTO_MISS_QUEUE)
    private readonly autoMissQueue: Queue<AutoMissJobData>,
  ) {}
  onModuleInit() {
    this.ChatGrpcService =
      this.chatClient.getService<ChatGrpcService>('ChatService');
    this.AiGrpcService = this.aiClient.getService<AiGrpcService>('AIService');
  }

  /**
   * Resolve whether `userUlid`'s `USER_IN_CALL` marker is genuinely live or
   * stale. Returns:
   *   - `live`: the marker points at the same call the user is trying to
   *     enter — no rejection needed (multi-device / renegotiation case).
   *   - `clear`: the marker is for a DIFFERENT call that the DB confirms has
   *     ended. We've already cleaned up the stale `USER_IN_CALL` /
   *     `USER_CALL_SOCKET` keys, caller should proceed.
   *   - `reject`: the marker is for a different call that is genuinely still
   *     active — reject with `already_in_call`.
   *
   * Used before the `if (inCallId && inCallId !== data.callId)` reject so a
   * stale marker (popup crash, beforeunload didn't fire EndCall, etc.)
   * doesn't permanently lock the user out of new calls.
   */
  private async validateInCallOrClearStale(
    userUlid: string,
    incomingCallId: string,
  ): Promise<
    { kind: 'live' } | { kind: 'clear' } | { kind: 'reject'; inCallId: string }
  > {
    const inCallId = await this.redis.getData<string>(
      this.key.USER_IN_CALL(userUlid),
    );
    if (!inCallId || inCallId === incomingCallId) {
      return { kind: 'live' };
    }

    try {
      const status = (await Utils.dispatchGrpcRequest(
        (d) => this.ChatGrpcService.GetCallStatus(d),
        { callId: inCallId },
      )) as {
        statusCode: number;
        metadata?: { ended?: boolean; exists?: boolean };
      };

      const ended =
        status?.statusCode === 200 &&
        (status.metadata?.ended === true || status.metadata?.exists === false);

      if (ended) {
        await this.redis.delKey(this.key.USER_IN_CALL(userUlid));
        await this.redis.delKey(this.key.USER_CALL_SOCKET(userUlid));
        this.logger.log(
          `[CALL] Cleared stale USER_IN_CALL for ${userUlid} (DB says ${inCallId} ended)`,
        );
        return { kind: 'clear' };
      }
    } catch (err) {
      this.logger.warn(
        `[CALL] GetCallStatus failed for ${inCallId}: ${
          err instanceof Error ? err.message : String(err)
        } — falling back to reject`,
      );
    }

    return { kind: 'reject', inCallId };
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
  // 📦 ACTIVE-CALL STATE (sharing / camera / mic) — Redis
  // ========================================================
  //
  // Rationale: late-joiners and re-joiners would otherwise have to wait for
  // the next event toggle to learn who's sharing / cam-off / mic-off. We
  // mirror those toggle events into per-room Redis sets, then bundle the
  // current snapshot into call:join / call:accepted responses so the joiner
  // renders correct UI from the first frame.
  //
  // TTL is refreshed on every mutation; sets/hashes auto-delete when the
  // last member is removed (Redis behavior). When the call genuinely ends
  // (everyone leaves or call:end status='ended'), explicit cleanup wipes
  // any stragglers.

  /**
   * Read the current shared state of a call (everyone, not just the
   * caller). Used to seed late-joiners' UI.
   */
  private async getCallState(roomId: string): Promise<{
    sharing: Array<{ userId: string; screenProducerId: string | null }>;
    cameraOff: string[];
    micOff: string[];
  }> {
    const [sharing, producerMap, cameraOff, micOff] = await Promise.all([
      this.redis.sMembers(this.key.CALL_SHARING(roomId)),
      this.redis.hGetAll(this.key.CALL_SHARING_PRODUCER(roomId)),
      this.redis.sMembers(this.key.CALL_CAMERA_OFF(roomId)),
      this.redis.sMembers(this.key.CALL_MIC_OFF(roomId)),
    ]);
    return {
      sharing: sharing.map((userId) => ({
        userId,
        screenProducerId: producerMap[userId] ?? null,
      })),
      cameraOff,
      micOff,
    };
  }

  /**
   * Drop a user from every per-room call state set (sharing, cam-off, mic-
   * off, share producer hash). Called on partial leave (call:end with peers
   * remaining) and on socket disconnect mid-call.
   * Sets/hashes auto-delete when the last member/field is removed, so this
   * is also the only cleanup needed for the empty-room case.
   */
  private async cleanupUserCallState(
    roomId: string,
    userId: string,
  ): Promise<void> {
    await Promise.all([
      this.redis.sRem(this.key.CALL_SHARING(roomId), userId),
      this.redis.hDel(this.key.CALL_SHARING_PRODUCER(roomId), userId),
      this.redis.sRem(this.key.CALL_CAMERA_OFF(roomId), userId),
      this.redis.sRem(this.key.CALL_MIC_OFF(roomId), userId),
    ]);
  }

  /**
   * Hard-delete every CALL_* key for a room. Use only on definitive call
   * end (status='ended' from the chat service or last participant left).
   * Cheap because key set is small (4 fixed keys).
   */
  private async wipeCallState(roomId: string): Promise<void> {
    await Promise.all([
      this.redis.delKey(this.key.CALL_SHARING(roomId)),
      this.redis.delKey(this.key.CALL_SHARING_PRODUCER(roomId)),
      this.redis.delKey(this.key.CALL_CAMERA_OFF(roomId)),
      this.redis.delKey(this.key.CALL_MIC_OFF(roomId)),
    ]);
  }

  // ========================================================
  // 📞 PENDING-INVITE REPLAY (race-resilient ringing)
  // ========================================================
  //
  // Problem: `call:request` is fire-and-forget over Socket.IO. If the
  // callee's socket isn't connected at the moment the caller emits
  // (logged out, tab not open, mid-reconnect after network blip), the
  // event is lost and the IncomingCallModal never shows — the call rings
  // on the caller's side but the callee has no idea.
  //
  // Solution: persist a per-(callee, callId) record while ringing. On
  // socket connect, gateway reads the record and re-emits `call:request`
  // to the new socket so the modal still shows up.

  /**
   * Persist a pending invite for one callee. Called from handleCallRequest
   * for every recipient (free, non-busy room member). TTL is short — the
   * ringing window. The HASH itself is also TTLd via expire().
   */
  private async storePendingInvite(
    calleeId: string,
    callId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const key = this.key.CALL_PENDING_INVITES(calleeId);
    await this.redis.hSet(key, { [callId]: JSON.stringify(payload) });
    // Refresh TTL on every store — each new invite extends the window.
    // Older entries get a free extension; fine because they're short-
    // lived anyway (ringing ~30s, server-side TTL ~60s).
    await this.redis.expire(key, 60);
  }

  /** Clear one user's invite for one specific call. */
  private async clearPendingInvite(
    calleeId: string,
    callId: string,
  ): Promise<void> {
    await this.redis.hDel(this.key.CALL_PENDING_INVITES(calleeId), callId);
  }

  /**
   * Bulk-clear an invite from EVERY recipient. Use on call:end (any
   * status — once the call is over, no leftover invite should fire).
   */
  private async clearPendingInvitesForAll(
    callId: string,
    memberIds: string[],
  ): Promise<void> {
    if (memberIds.length === 0) return;
    await Promise.all(
      memberIds.map((id) => this.clearPendingInvite(id, callId)),
    );
  }

  // ─── Per-call participants tracking ───────────────────────────────
  // Two Redis keys kept in lockstep:
  //   call:participants:{mode}:{callId}  → SET<userId>
  //   call:user_in_calls:{userId}        → SET<participantsKey>
  //
  // The reverse index is the missing piece that fixed phantom
  // participants visible in Redis Insight after browsers crashed.
  // Without it, a disconnect handler only knew about the ONE
  // active-call key from `USER_CALL_SOCKET`; if that marker was
  // already gone or pointed at a different call, the user stayed
  // in OTHER participant sets forever (until 8h TTL).

  private participantsKeyOf(mode: 'p2p' | 'sfu', callId: string): string {
    return `call:participants:${mode}:${callId}`;
  }

  private userInCallsKeyOf(userId: string): string {
    return `call:user_in_calls:${userId}`;
  }

  /**
   * Add user to a call's participants set + the user's reverse index.
   * Refreshes TTL on both. Idempotent — SADD is a no-op if already in.
   */
  private async addCallParticipant(
    userId: string,
    mode: 'p2p' | 'sfu',
    callId: string,
  ): Promise<void> {
    const participantsKey = this.participantsKeyOf(mode, callId);
    const userIndexKey = this.userInCallsKeyOf(userId);
    await Promise.all([
      this.redis.sAdd(participantsKey, userId),
      this.redis.sAdd(userIndexKey, participantsKey),
    ]);
    await Promise.all([
      this.redis.expire(participantsKey, REDIS_TTL.CALL_ACTIVE),
      this.redis.expire(userIndexKey, REDIS_TTL.CALL_ACTIVE),
    ]);
  }

  /**
   * Remove user from a single call's participants set + drop the
   * reverse-index entry. If the participants set is now empty, DEL
   * the key entirely so steady-state Redis stays clean.
   * Returns the remaining participant count (-1 on error).
   */
  private async removeCallParticipant(
    userId: string,
    mode: 'p2p' | 'sfu',
    callId: string,
  ): Promise<number> {
    const participantsKey = this.participantsKeyOf(mode, callId);
    const userIndexKey = this.userInCallsKeyOf(userId);
    try {
      await Promise.all([
        this.redis.sRem(participantsKey, userId),
        this.redis.sRem(userIndexKey, participantsKey),
      ]);
      const remaining = await this.redis.sCard(participantsKey);
      if (remaining === 0) {
        await this.redis.delKey(participantsKey);
      }
      return remaining;
    } catch (err) {
      this.logger.warn(
        `[CALL] removeCallParticipant failed for ${userId} → ${participantsKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return -1;
    }
  }

  /**
   * Disconnect / logout sweep: SREM user from EVERY participant set
   * they're listed in, then drop the reverse index. Run on socket
   * disconnect — covers crash / network-drop cases where the FE never
   * fires an explicit call:end. Without this, phantom participants
   * accumulate in Redis Insight (`participants > sfu > {callId}`)
   * across many calls.
   */
  private async sweepUserFromAllCalls(userId: string): Promise<void> {
    const userIndexKey = this.userInCallsKeyOf(userId);
    try {
      const participantKeys = await this.redis.sMembers(userIndexKey);
      if (participantKeys.length === 0) return;
      // SREM from each + delete empty sets in parallel.
      await Promise.all(
        participantKeys.map(async (participantsKey) => {
          await this.redis.sRem(participantsKey, userId);
          const remaining = await this.redis.sCard(participantsKey);
          if (remaining === 0) {
            await this.redis.delKey(participantsKey);
          }
        }),
      );
      await this.redis.delKey(userIndexKey);
      this.logger.log(
        `[CALL] swept ${userId} from ${participantKeys.length} participant set(s)`,
      );
    } catch (err) {
      this.logger.warn(
        `[CALL] sweepUserFromAllCalls failed for ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Schedule a server-side auto-miss task. Enqueues a Bull job with a
   * 30s delay; at fire time, `CallAutoMissProcessor` invokes
   * `executeAutoMiss` (below) which checks the pending-invites Redis
   * hash — if the FE already accepted/rejected, it bails; otherwise it
   * synthesizes `call:end status='missed'` so the caller's UI exits
   * "ringing" instead of waiting on the 1h USER_IN_CALL TTL.
   *
   * Why Bull instead of setTimeout:
   *   - Persistence: jobs live in Redis, survive pod restarts.
   *   - Distributed lock: under multi-pod Cloud Run autoscale, exactly
   *     one worker pod processes each job (no double-fire).
   *   - jobId scoping: same (callee, callId) can't enqueue twice — Bull
   *     dedups; relevant if a duplicate call:request somehow gets
   *     through.
   */
  private autoMissJobId(callId: string, calleeId: string): string {
    return `auto-miss:${callId}:${calleeId}`;
  }

  /**
   * Cancel a queued auto-miss job for one (callId, calleeId). Called on
   * accept / join — the user is clearly responsive, no point letting the
   * 30s timer fire and race with their state. Without this, bugs in the
   * pending-invite cleanup path could let executeAutoMiss flip a live
   * participant to `missed` mid-call.
   */
  private async cancelAutoMissInvite(
    calleeId: string,
    callId: string,
  ): Promise<void> {
    try {
      const job = await this.autoMissQueue.getJob(
        this.autoMissJobId(callId, calleeId),
      );
      if (job) await job.remove();
    } catch (err) {
      this.logger.warn(
        `[CALL] Failed to cancel auto-miss job ${callId}/${calleeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async scheduleAutoMissInvite(
    calleeId: string,
    callId: string,
    roomId: string,
  ): Promise<void> {
    try {
      await this.autoMissQueue.add(
        { calleeId, callId, roomId },
        {
          delay: 30_000,
          // Stable jobId so cancelAutoMissInvite can find + remove it
          // on accept/join. Also dedupes — Bull rejects duplicate jobIds
          // while the original is queued/active.
          jobId: this.autoMissJobId(callId, calleeId),
        },
      );
    } catch (err) {
      // Don't let queue failures block the call:request response. The FE
      // 30s timer is still primary; this server-side backup just won't
      // fire on this particular invite.
      this.logger.warn(
        `[CALL] Failed to enqueue auto-miss job for ${callId}/${calleeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Public entry point invoked by `CallAutoMissProcessor` when the 30s
   * Bull job fires. Idempotent — bails if the invite has already been
   * cleared (FE accepted, FE rejected/missed, or another fire already
   * processed it). gRPC `EndCall` on the chat service is also no-op for
   * already-ended calls, so a race between the FE emit and this method
   * is safe.
   */
  async executeAutoMiss(
    calleeId: string,
    callId: string,
    roomId: string,
  ): Promise<void> {
    const pending = await this.redis.hGetAll(
      this.key.CALL_PENDING_INVITES(calleeId),
    );
    if (!pending[callId]) return;

    // Belt-and-suspenders: if the user is already in this call's
    // participants set (accepted via call:accepted OR joined via
    // call:join), they are NOT missed regardless of invite state. This
    // guards against any future code path that adds participants without
    // clearing the invite + cancelling the job.
    const sfuParticipants = this.participantsKeyOf('sfu', callId);
    const p2pParticipants = this.participantsKeyOf('p2p', callId);
    const [inSfu, inP2p] = await Promise.all([
      this.redis.sIsMember(sfuParticipants, calleeId),
      this.redis.sIsMember(p2pParticipants, calleeId),
    ]);
    if (inSfu || inP2p) {
      this.logger.log(
        `[CALL] AUTO-MISS skipped — user ${calleeId} already a participant of ${callId}`,
      );
      // Stale invite → drop it so reconnect doesn't replay.
      await this.clearPendingInvite(calleeId, callId);
      return;
    }

    // Capture history from EndCall — we need `history.members` so the FE
    // toast handler can tell 1-on-1 (length <= 2 → close call entirely)
    // from group call (length > 2 → just toast "X didn't answer" and
    // keep the call running for the people who DID pick up). Without
    // members in the broadcast, FE would treat every auto-miss as 1-on-1
    // and show "call will close" even when 3+ people are happily talking.
    const result = (await Utils.dispatchGrpcRequest(
      (d) => this.ChatGrpcService.EndCall(d),
      {
        actionUserId: calleeId,
        roomId,
        callId,
        status: 'missed',
      },
    )) as ChatGatewayCallResponse;
    const members = result?.metadata?.history?.members ?? [];

    await this.clearPendingInvite(calleeId, callId);
    this.io.to(roomId).emit('call:end', {
      roomId,
      actionUserId: calleeId,
      callId,
      status: 'missed',
      members,
      reason: 'auto_miss_timeout',
    });

    this.logger.log(
      `[CALL] AUTO-MISS roomId=${roomId} callId=${callId} callee=${calleeId} (30s timeout, members=${members.length})`,
    );
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

      // Redis blacklist check — presence at REFRESH_TOKEN(userId, jti)
      // means the JTI has been revoked. Live tokens are NOT stored, so
      // ABSENCE = valid (combined with the JWT verify above passing).
      if (payload.jti && payload._id) {
        const isRevoked = await this.redis.getData<string>(
          this.key.REFRESH_TOKEN(payload._id, payload.jti),
        );

        if (isRevoked) {
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
      client.user = payload;

      // Delegate presence to PresenceService — keyed by usr_id, namespace
      // "call". The /chat gateway already broadcasts STATUS through the
      // chat namespace; this call-side register only contributes a member
      // to the user's online set so e.g. a /chat tab disconnect doesn't
      // mark a user offline if they still have a /call popup open.
      await this.presence.register('call', client.id, payload.usr_id);

      this.logger.log(
        `[CONNECT] User call ${payload.usr_fullname} (${payload._id}) connected.`,
      );
      const roomIds = await this.redis.sMembers(
        this.key.USER_ROOMS(client.userId),
      );
      await client.join(roomIds);

      // Replay any pending call invites — covers the case where the caller
      // emitted call:request while this user was offline (logged out, tab
      // closed, mid-reconnect). Each entry is a serialized historyCall
      // payload identical in shape to what handleCallRequest emits live.
      // Cleared on call:accepted / call:end, with a 60s server TTL backup.
      try {
        const pendingInvites = await this.redis.hGetAll(
          this.key.CALL_PENDING_INVITES(payload.usr_id),
        );
        for (const [pendingCallId, payloadStr] of Object.entries(
          pendingInvites,
        )) {
          try {
            const invite = JSON.parse(payloadStr) as Record<string, unknown>;
            client.emit('call:request', invite);
            this.logger.log(
              `[CONNECT] Replayed pending invite ${pendingCallId} → ${payload.usr_id}`,
            );
          } catch (err) {
            this.logger.warn(
              `[CONNECT] Bad pending invite payload for ${payload.usr_id}/${pendingCallId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            // Drop the unparseable entry so it doesn't keep failing on
            // every reconnect.
            await this.clearPendingInvite(payload.usr_id, pendingCallId);
          }
        }
      } catch (err) {
        this.logger.warn(
          `[CONNECT] Pending-invite replay failed for ${payload.usr_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[CONNECT] Authentication failed for client ${client.id}: ${errorMessage}`,
      );
      client.emit(socketEvent.EXCEPTION, {
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
    const usrId = client.user?.usr_id;

    if (userId) {
      this.logger.log(
        `[DISCONNECT] User ${fullname} (${userId}) disconnected.`,
      );

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

          // Decide if this disconnecting socket was actively in a call
          // by checking ITS OWN socket rooms — the popup window joined
          // `room.room_id` on accept/start, the chat tab didn't.
          //   - Popup closed: client.rooms has the call room → cleanup
          //   - Chat tab closed: only system/client:<id> rooms → skip
          //
          // Why this is more reliable than checking USER_CALL_SOCKET
          // == client.id: the Redis pointer can drift on rare crashes
          // (claimCallSocket overwrote on multi-device handoff but old
          // socket never disconnected, etc.). The socket's own room
          // membership is the ground truth — Socket.IO maintains it
          // and we can't fake it from outside.
          let endRoomId: string | null = null;
          for (const socketRoom of client.rooms) {
            if (socketRoom === client.id) continue;
            if (socketRoom === 'system') continue;
            if (socketRoom.startsWith('client:')) continue; // ROOM_CLIENT(usr_id)
            endRoomId = socketRoom;
            break;
          }

          if (activeCallId && endRoomId) {
            // 1. Update CallHistory in DB via gRPC. status='ended' lets
            //    the chat service compute member.status correctly
            //    (ended for leavers; ended_at when caller leaves or
            //    all members ended).
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

            // 3. Drop this user from per-room sharing/cam-off/mic-off
            //    Sets so the next late-joiner's snapshot doesn't include
            //    a ghost entry. Auto-deletes the key when last member is
            //    removed (Redis behavior), so no extra "if empty" check.
            await this.cleanupUserCallState(endRoomId, userUlid);

            // 4. Sweep user from EVERY participants set + reverse
            //    index. Covers the active call AND any phantom entries
            //    left from past crashes (no graceful endCall fired).
            await this.sweepUserFromAllCalls(userUlid);

            // 5. Clear the in-call flag + active call socket so
            //    reconnects don't show stale "busy" + handoff state
            //    resets. Only delete USER_CALL_SOCKET if THIS socket
            //    was the active one — otherwise we'd wipe out a
            //    handoff to another device.
            await this.redis.delKey(this.key.USER_IN_CALL(userUlid));
            const activeSocketId = await this.redis.getData<string>(
              this.key.USER_CALL_SOCKET(userUlid),
            );
            if (!activeSocketId || activeSocketId === client.id) {
              await this.redis.delKey(this.key.USER_CALL_SOCKET(userUlid));
            }

            this.logger.log(
              `[CALL] LEFT-by-disconnect roomId=${endRoomId} callId=${activeCallId} userId=${userUlid} (socket dropped)`,
            );
          }
        } catch (err) {
          this.logger.error(
            `[DISCONNECT] Failed to update call state for ${userUlid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Delegate presence cleanup to PresenceService — it removes this
      // /call socket from the user's online set; broadcasts offline only
      // when no other socket (other tab, /chat, /doc) is left.
      if (usrId && userUlid) {
        const { wentOffline } = await this.presence.unregister(
          'call',
          client.id,
          usrId,
        );
        if (wentOffline) {
          this.io.emit('system', `${fullname} went offline.`);
          // Defensive sweep: if every socket of this user is gone
          // (chat tab, call popup, doc tab — all closed/crashed), the
          // user can NOT be in any call anymore. Wipe their entries
          // from every participants set + the reverse index. This is
          // the safety net for crash scenarios where the active-call-
          // socket-id check upstream missed (stale USER_CALL_SOCKET
          // pointing at a long-dead socket, popup OS-killed, etc.) —
          // without it the user's id lingers in `call:participants:*`
          // for hours until TTL.
          await this.sweepUserFromAllCalls(userUlid);
          // Also clear the per-user in-call markers so a future
          // `validateInCallOrClearStale` check on this user starts
          // fresh on next login.
          await Promise.all([
            this.redis.delKey(this.key.USER_IN_CALL(userUlid)),
            this.redis.delKey(this.key.USER_CALL_SOCKET(userUlid)),
          ]);
        }
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
      // CallHistory so DB stays clean. Pass empty incomingCallId so the
      // helper will validate any existing marker against the DB and clear
      // it if the call has already ended.
      const callerValidation = await this.validateInCallOrClearStale(
        user.usr_id,
        '',
      );
      if (callerValidation.kind === 'reject') {
        this.logger.warn(
          `[CALL] Reject request: caller ${user.usr_id} already in call ${callerValidation.inCallId}`,
        );
        client.emit('error', {
          message:
            'Bạn đang trong cuộc gọi khác, không thể bắt đầu cuộc gọi mới',
          error: 'caller_already_in_call',
          callId: callerValidation.inCallId,
        });
        return { ok: false, reason: 'caller_already_in_call' };
      }

      const memberIds = data.membersIds ?? [];
      const targetIds = memberIds.filter((id) => id !== user.usr_id);

      // ─── Stale-marker recovery for any target ────────────────────────────
      // If a target's USER_IN_CALL points at a call the DB confirms has
      // ended (popup crashed, beforeunload didn't fire EndCall), clear it
      // so the FE doesn't show a "waiting call" banner when in fact no
      // call exists. We DON'T reject on busy — letting busy users receive
      // the call:request enables the FE waiting-call UX (notification +
      // accept-to-switch).
      for (const targetUserId of targetIds) {
        await this.validateInCallOrClearStale(targetUserId, '');
      }

      // ─── Track busy targets (informational only — caller UI may flag) ─────
      // Previously we used this to skip emitting call:request to busy
      // members. Now we send to ALL targets so each can individually
      // decide to switch or stay; busyTargets is kept only for the
      // response payload so the caller can label them.
      const busyTargets = new Map<string, string>(); // userId → callId
      if (targetIds.length > 0) {
        const busyKeys = targetIds.map((id) => this.key.USER_IN_CALL(id));
        const busyValues = await this.redis.mget(busyKeys);
        targetIds.forEach((id, i) => {
          const v = busyValues[i];
          if (v) {
            busyTargets.set(
              id,
              typeof v === 'string' ? JSON.parse(v) : String(v),
            );
          }
        });
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

      this.logger.log(
        `[CALL] STARTED roomId=${room.room_id} callId=${history.call_id} caller=${user.usr_id} mode=${callMode} type=${callType} members=${history.members.length}`,
      );

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

      // Per-call participant set (mode-segregated) + reverse index.
      // Caller is the first participant — joiner adds, leaver removes.
      // SCARD === 0 = call truly empty → key auto-deleted in
      // removeCallParticipant.
      await this.addCallParticipant(
        user.usr_id,
        callMode === 'sfu' ? 'sfu' : 'p2p',
        history.call_id,
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
      // Send call:request to ALL room members (except caller). Busy
      // members get the event too — their FE renders a waiting-call
      // banner and lets them switch by ending their current call.
      //
      // De-dupe by user id: if the same member somehow appears twice
      // in `room_members` (data quality / migration glitch), we'd
      // schedule TWO Bull jobs with the SAME jobId — one would still
      // fire, but the audit log + storePendingInvite double-write +
      // socket-room emit aliasing have caused intermittent
      // "channel mapping" mismatches between FE/BE for that callee.
      // Deduping at the source eliminates the whole class of issue.
      const inviteRecipients = Array.from(
        new Map(
          room.room_members
            .filter((m) => m.id !== user.usr_id)
            .map((m) => [m.id, m]),
        ).values(),
      );
      const otherMembers = inviteRecipients.map((m) =>
        this.key.ROOM_CLIENT(m.id),
      );
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

      // Persist a pending invite for every recipient so a callee whose
      // socket wasn't connected at emit time (logged out / tab not open
      // yet / network blip) still gets the IncomingCallModal when they
      // reconnect within the ringing window. Replay happens in
      // handleConnection. Cleared in handleAccepted / handleEnd.
      await Promise.all(
        inviteRecipients.map((m) =>
          this.storePendingInvite(m.id, history.call_id, historyCall),
        ),
      );

      // Schedule a server-side auto-miss timer per recipient as a backup
      // to the FE 30s decline timer. Covers crashed tabs / never-opened
      // FE / multi-device cases where no client ever fires the missed
      // event — without this the caller would ring until their own
      // USER_IN_CALL TTL (1h) saves them.
      await Promise.all(
        inviteRecipients.map((m) =>
          this.scheduleAutoMissInvite(m.id, history.call_id, room.room_id),
        ),
      );

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

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: SocketWithUser) {
    if (!client.user?.usr_id) return;
    await this.presence.heartbeat('call', client.id, client.user.usr_id);
  }

  @SubscribeMessage(socketEvent.USERSATUS)
  async handleCheckUserStatus(
    @MessageBody() userIds: string[],
    @ConnectedSocket() client: SocketWithUser,
  ) {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) return;
    try {
      // Delegate to PresenceService — single canonical "is X online?"
      // implementation across both /chat and /call namespaces. Returns one
      // entry per requested id so the FE can apply results in a single pass
      // (no need to merge multiple per-user STATUS events).
      const result = await this.presence.getBulkStatus(userIds);
      client.emit('status:online:bulk', { users: result });
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

      this.logger.log(
        `[CALL] ACCEPT-IN client=${client.id} userId=${user.usr_id} callId=${data.callId} targetUserId=${data.targetUserId} hasOffer=${!!data.offer} renegotiate=${(data as { renegotiate?: boolean }).renegotiate === true}`,
      );

      // Renegotiation fast-path: when the FE re-emits `call:accepted` mid-call
      // to push a new SDP offer (e.g. screen-share starts → addTransceiver →
      // createOffer), it sets `renegotiate=true`. This is NOT a fresh accept
      // — the user is already in the call and has a PC. Skip the dedup lock,
      // the in-call validation, the gRPC AcceptCall (which would re-update
      // member.status), and the socket-room join. Just relay the offer to
      // the targeted peer's socket so they can apply it via setRemoteDescription.
      const renegotiate =
        (data as { renegotiate?: boolean }).renegotiate === true;
      if (renegotiate) {
        const targetSocketId = this.key.ROOM_CLIENT(data.targetUserId);
        this.io.to(targetSocketId).emit('call:accepted', {
          members: (data as { members?: unknown }).members,
          roomId: data.roomId,
          actionUserId: data.actionUserId,
          offer: data.offer,
          callId: data.callId,
          renegotiate: true,
        });
        return { ok: true };
      }

      // Deduplicate: ignore duplicate call:accepted from same user for same call
      // (caused by socket reconnects re-triggering the frontend useEffect)
      const acceptLockKey = `call:accept:lock:${data.callId}:${data.actionUserId}`;
      const alreadyAccepted: string | null =
        await this.redis.getData(acceptLockKey);
      if (alreadyAccepted) {
        return { ok: true };
      }

      // Server-side guard: reject accept ONLY if user is in a DIFFERENT
      // active call. Same callId is allowed (multi-device accept) and a
      // marker pointing at an already-ended call is treated as stale and
      // cleared instead of blocking forever (popup-crash recovery).
      const validation = await this.validateInCallOrClearStale(
        data.actionUserId,
        data.callId,
      );
      if (validation.kind === 'reject') {
        this.logger.warn(
          `[CALL] Reject accept: user ${data.actionUserId} already in call ${validation.inCallId}`,
        );
        client.emit('error', {
          message: 'Bạn đang trong cuộc gọi khác',
          error: 'already_in_call',
          callId: validation.inCallId,
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

      if (!result || result.statusCode !== 200) {
        const errorMessage = Array.isArray(result?.message)
          ? result.message.join(', ')
          : result?.message || 'Trả lời cuộc gọi thất bại';
        throw new BadRequestException(String(errorMessage));
      }

      const { history, room, msg, callMode } = result.metadata;
      this.logger.log(
        `[CALL] ACCEPTED roomId=${room.room_id} callId=${data.callId} callee=${data.actionUserId} caller=${data.targetUserId} mode=${callMode ?? 'undefined(!)'}`,
      );

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

      // Add callee to participants set + reverse index. Helper handles
      // both keys + TTL refresh in one call.
      await this.addCallParticipant(
        actionUserId,
        callMode === 'sfu' ? 'sfu' : 'p2p',
        data.callId,
      );

      // Callee has accepted — no longer need their pending invite. Don't
      // wait for the natural TTL expiry: a user could disconnect right
      // after accept, reconnect 5s later, and replay the now-stale invite.
      await this.clearPendingInvite(actionUserId, data.callId);
      // Also actively remove the queued Bull auto-miss job for this
      // user. Pending-invite cleanup alone makes executeAutoMiss bail
      // at line 511, but if anything ever re-seeded the invite (replay
      // bug, FE retry, etc.) the job would still flip a live participant
      // to `missed` mid-call. Cancelling the job is the belt to
      // clearPendingInvite's suspenders.
      await this.cancelAutoMissInvite(actionUserId, data.callId);

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
        const targetSocketRoom = this.key.ROOM_CLIENT(data.targetUserId);
        // Inspect the room: if no socket is currently in it, the
        // forwarded `call:accepted` will go nowhere — caller will be
        // stuck on "calling" forever. Logging the size lets us verify
        // whether the caller's socket actually joined ROOM_CLIENT(<id>)
        // during handleConnection.
        // Use the official `in(...).fetchSockets()` API instead of
        // poking at `adapter.rooms` directly — adapter access is
        // overloaded (constructor setter / instance getter) in
        // socket.io v4 types and trips TS, while fetchSockets() is
        // typed and works the same across namespaces + Redis adapter.
        const targetSocketCount = (
          await this.io.in(targetSocketRoom).fetchSockets()
        ).length;
        this.logger.log(
          `[CALL] FORWARD-OFFER (p2p) callId=${data.callId} from=${data.actionUserId} to=${data.targetUserId} targetRoom=${targetSocketRoom} socketsInRoom=${targetSocketCount}`,
        );
        this.io.to(targetSocketRoom).emit('call:accepted', {
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

      // Snapshot the current sharing/camera/mic state for the joiner. Same
      // rationale as call:join — let the FE render correct UI immediately
      // instead of waiting for the next toggle event from each peer.
      const callState = await this.getCallState(room.room_id);

      return { ok: true, callState };
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

      // Server-side guard: reject join ONLY if user is in a DIFFERENT
      // active call. Same callId is allowed (multi-device join → handoff).
      // A marker pointing at an already-ended call (popup crashed without
      // running EndCall etc.) is treated as stale and cleared instead of
      // permanently locking the user out.
      const validation = await this.validateInCallOrClearStale(
        data.actionUserId,
        data.callId,
      );
      if (validation.kind === 'reject') {
        this.logger.warn(
          `[CALL] Reject join: user ${data.actionUserId} already in call ${validation.inCallId}`,
        );
        client.emit('error', {
          message: 'Bạn đang trong cuộc gọi khác',
          error: 'already_in_call',
          callId: validation.inCallId,
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

      // Re-joiners (popup crashed → reopened, network blip, multi-device
      // handoff) take the call:join path instead of call:accepted, so
      // we ALSO need to clear their pending invite + cancel the queued
      // auto-miss job here. Without this, a user who joins via call:join
      // gets flipped to `missed` 30s after the call started — exactly
      // the bug seen in production logs.
      await this.clearPendingInvite(data.actionUserId, data.callId);
      await this.cancelAutoMissInvite(data.actionUserId, data.callId);

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

      // Snapshot the per-room sharing/camera/mic state so the late-joiner's
      // FE can render the correct UI from the first frame instead of
      // waiting for the next toggle event from each peer (which may never
      // come during a stable call).
      const callState = await this.getCallState(room.room_id);

      return { ok: true, history, room, callState };
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
      // Heartbeat: refresh the participants set TTL whenever a signal
      // flows through. Calls > 1h would otherwise lose their key when
      // the original SADD's TTL expires — this turns each user's
      // ongoing SFU/P2P activity into a keep-alive. Best-effort: if
      // callId/userId aren't on the payload (e.g. legacy signals),
      // skip silently.
      try {
        const userId = client.user?.usr_id ?? client.userId;
        const callId = (payload as { callId?: string })?.callId;
        const target = (payload as { target?: string })?.target;
        if (userId && callId && (target === 'sfu' || target === 'p2p')) {
          // Refresh BOTH the participants set AND the user reverse
          // index — both keys share the same 8h TTL, both should
          // outlive a continuously-active call.
          await Promise.all([
            this.redis.expire(
              this.participantsKeyOf(target, callId),
              REDIS_TTL.CALL_ACTIVE,
            ),
            this.redis.expire(
              this.userInCallsKeyOf(userId),
              REDIS_TTL.CALL_ACTIVE,
            ),
          ]);
        }
      } catch {
        // never block signal handling on heartbeat refresh
      }

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

      // ── Clear all pending invites for this call ──────────────────────────
      // Once the call has ended (rejected/missed/cancelled/ended), no
      // recipient should still be holding a stale invite. Without this, a
      // user reconnecting within the 60s TTL window after a cancelled call
      // would get a phantom IncomingCallModal for a call that no longer
      // exists. Iterate over history.members (covers everyone originally
      // invited, including those who already accepted — `hDel` of a
      // missing field is a no-op).
      const inviteeIds = (history?.members ?? []).map(
        (m: { id: string }) => m.id,
      );
      await this.clearPendingInvitesForAll(data.callId, inviteeIds);

      // Clear the per-user accept-lock keys for this call. handleAccept
      // sets `call:accept:lock:<callId>:<userId>` (TTL=1h) to dedupe
      // duplicate call:accepted from the same user. Without proactive
      // cleanup the keys linger in Redis after the call has truly
      // ended, polluting `KEYS chats:call:accept:lock:*` views even
      // when the system has zero active calls. They auto-expire in 1h
      // anyway — this just makes the steady state clean.
      await Promise.all(
        inviteeIds.map((id) =>
          this.redis.delKey(`call:accept:lock:${data.callId}:${id}`),
        ),
      );

      // ── Per-user in-call markers ─────────────────────────────────────────
      // Bug fix: previous code deleted USER_IN_CALL + USER_CALL_SOCKET for
      // every member on every call:end — but in a group call only the
      // leaver actually left, so wiping everyone's markers corrupted multi-
      // device handoff and the busy-check for remaining participants.
      //
      // New behavior: ALWAYS clear the leaver's markers; only clear OTHER
      // members' markers when the call has fully ended (no member is still
      // in 'started' state, i.e. nobody is actively in the room).
      const stillActive = (history?.members ?? []).some(
        (m: { status?: string }) => m.status === 'started',
      );
      // SREM actor from the per-call participants set + reverse index
      // via the helper. Mode-segregated key — matches addCallParticipant
      // in handleCallRequest / handleAccept.
      let participantsRemaining = -1;
      const callModeKey = history?.call_mode === 'sfu' ? 'sfu' : 'p2p';
      if (data.actionUserId) {
        participantsRemaining = await this.removeCallParticipant(
          data.actionUserId,
          callModeKey,
          data.callId,
        );
        if (participantsRemaining === 0) {
          this.logger.log(
            `[CALL] PARTICIPANTS-EMPTY callId=${data.callId} mode=${callModeKey} → key removed`,
          );
        }
      }

      if (data.actionUserId) {
        await Promise.all([
          this.redis.delKey(this.key.USER_IN_CALL(data.actionUserId)),
          this.redis.delKey(this.key.USER_CALL_SOCKET(data.actionUserId)),
        ]);
        // Drop the leaver from the per-room sharing/cam-off/mic-off Sets
        // so remaining members reading callState don't see ghost entries.
        // Sets auto-delete on last sRem, so no separate "if empty" check.
        await this.cleanupUserCallState(room.room_id, data.actionUserId);
      }
      if (!stillActive && history?.members) {
        await Promise.all(
          history.members.flatMap((m: { id: string }) => [
            this.redis.delKey(this.key.USER_IN_CALL(m.id)),
            this.redis.delKey(this.key.USER_CALL_SOCKET(m.id)),
          ]),
        );
        // Defensive wipe of any straggler keys; sets should already be
        // empty by now since each leaver hit the cleanup branch above.
        await this.wipeCallState(room.room_id);
      }

      this.logger.log(
        `[CALL] ENDED-by-user roomId=${room.room_id} callId=${data.callId} actor=${data.actionUserId} status=${data.status} stillActive=${stillActive} participantsRemaining=${participantsRemaining} memberCount=${history?.members?.length ?? 0}`,
      );

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
      // SFU only — producer id of the screen producer, so late-joiners can
      // pre-populate `screenProducerIds` and route the consumed track to
      // remoteScreenStreams instead of remoteStreams.
      screenProducerId?: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      // Persist the toggle in Redis so a late-joiner reading callState in
      // call:join can render the screen-share UI without waiting for the
      // next toggle (which may never come during a stable share).
      const sharingKey = this.key.CALL_SHARING(data.roomId);
      const producerKey = this.key.CALL_SHARING_PRODUCER(data.roomId);
      if (data.isSharing) {
        await this.redis.sAdd(sharingKey, data.actionUserId);
        await this.redis.expire(sharingKey, REDIS_TTL.CALL_ACTIVE);
        if (data.screenProducerId) {
          await this.redis.hSet(producerKey, {
            [data.actionUserId]: data.screenProducerId,
          });
          await this.redis.expire(producerKey, REDIS_TTL.CALL_ACTIVE);
        }
      } else {
        await this.redis.sRem(sharingKey, data.actionUserId);
        await this.redis.hDel(producerKey, data.actionUserId);
      }

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

  /**
   * Relay camera on/off notifications between peers. Receivers use this to
   * swap the participant tile to an avatar immediately when the sender
   * turns their camera off, without waiting 5-10s for `track.muted` to fire
   * (Chrome keeps RTP flowing for `track.enabled=false`, sending black
   * frames, so the receive-side mute event lags or never fires).
   */
  @SubscribeMessage('call:camera-state')
  async handleCameraState(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      isCameraOn: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      const cameraOffKey = this.key.CALL_CAMERA_OFF(data.roomId);
      if (data.isCameraOn) {
        await this.redis.sRem(cameraOffKey, data.actionUserId);
      } else {
        await this.redis.sAdd(cameraOffKey, data.actionUserId);
        await this.redis.expire(cameraOffKey, REDIS_TTL.CALL_ACTIVE);
      }

      this.io.to(data.roomId).except(client.id).emit('call:camera-state', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error relaying camera-state:', error);
      return { ok: false };
    }
  }

  /**
   * Relay mic on/off notifications between peers. Same rationale as
   * camera-state: receivers can't infer mic state reliably from the audio
   * track alone (track.enabled=false still flows silent RTP), so we
   * broadcast an explicit signal for the UI to render a "muted" badge.
   */
  @SubscribeMessage('call:mic-state')
  async handleMicState(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      isMicOn: boolean;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;

      const micOffKey = this.key.CALL_MIC_OFF(data.roomId);
      if (data.isMicOn) {
        await this.redis.sRem(micOffKey, data.actionUserId);
      } else {
        await this.redis.sAdd(micOffKey, data.actionUserId);
        await this.redis.expire(micOffKey, REDIS_TTL.CALL_ACTIVE);
      }

      this.io.to(data.roomId).except(client.id).emit('call:mic-state', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error relaying mic-state:', error);
      return { ok: false };
    }
  }

  /**
   * Relay finalized speech-to-text segments between call participants.
   * Recognition still happens locally in each browser; the server only
   * stamps the authenticated sender id and broadcasts the text to peers.
   */
  @SubscribeMessage('call:stt-segment')
  async handleSttSegment(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      speaker: string;
      text: string;
      isFinal: boolean;
      timestamp: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      data.actionUserId = user.usr_id;
      data.speaker = user.usr_fullname || data.speaker;

      this.io.to(data.roomId).except(client.id).emit('call:stt-segment', data);
      return { ok: true };
    } catch (error) {
      this.logger.error('[CALL] Error relaying stt-segment:', error);
      return { ok: false };
    }
  }

  @SubscribeMessage('call:stt-audio-chunk')
  async handleSttAudioChunk(
    @MessageBody()
    data: {
      actionUserId?: string;
      roomId: string;
      speaker?: string;
      audioChunk: string;
      mimeType: string;
      language: string;
    },
    @ConnectedSocket() client: SocketWithUser,
  ) {
    try {
      const user = await this.getUser(client);
      const speaker = user.usr_fullname || data.speaker || 'Người tham gia';
      const language = data.language === 'en' ? 'en' : 'vi';

      if (!data.roomId || !data.audioChunk) {
        return { ok: false, error: 'Missing roomId or audioChunk' };
      }

      const audioBuffer = Buffer.from(data.audioChunk, 'base64');
      if (!audioBuffer.length) {
        return { ok: false, error: 'Empty audio chunk' };
      }

      const result = (await Utils.dispatchGrpcRequest(
        (d) => this.AiGrpcService.TranscribeRealtime(d),
        {
          audioChunk: audioBuffer,
          mimeType: data.mimeType || 'audio/webm',
          language,
          userId: user.usr_id,
          speakerName: speaker,
        },
      )) as {
        statusCode?: number;
        message?: string;
        reasonStatusCode?: string;
        metadata?: {
          transcript?: string;
          detectedLanguage?: string;
          speakerName?: string;
          isEmpty?: boolean;
        };
      };

      if (result.statusCode && result.statusCode !== 200) {
        const message =
          result.message || 'Không thể nhận dạng giọng nói lúc này';
        client.emit('call:stt-error', { message });
        return {
          ok: false,
          error: result.reasonStatusCode || message,
        };
      }

      const transcript = result.metadata?.transcript?.trim();
      if (result.statusCode === 200 && transcript) {
        const payload = {
          actionUserId: user.usr_id,
          roomId: data.roomId,
          speaker: result.metadata?.speakerName || speaker,
          text: transcript,
          detectedLanguage: result.metadata?.detectedLanguage || language,
          timestamp: new Date().toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        };

        client.emit('call:stt-result', payload);
        this.io
          .to(data.roomId)
          .except(client.id)
          .emit('call:stt-result', payload);
      }

      return { ok: true, isEmpty: !transcript };
    } catch (error) {
      this.logger.error('[CALL] STT chunk failed:', error);
      client.emit('call:stt-error', {
        message: 'Không thể nhận dạng giọng nói lúc này',
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
              // Blacklist check — presence = revoked.
              const isRevoked = await this.redis.getData<string>(
                this.key.REFRESH_TOKEN(payload._id, payload.jti),
              );

              if (!isRevoked) {
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

interface SocketCallMember {
  id: string;
  status?: string;
  [key: string]: any;
}

interface SocketCallHistory {
  call_id: string;
  started_at?: string | Date;
  call_mode?: string;
  message_id?: string | { toString(): string };
  members: SocketCallMember[];
  [key: string]: any;
}

interface SocketRoom {
  room_id: string;
  room_members: SocketCallMember[];
  [key: string]: any;
}

interface ChatGatewayCallResponse<T = any> {
  data: T;
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata: {
    history: SocketCallHistory;
    room: SocketRoom;
    callType: string;
    callMode?: string;
    msg: Record<string, any>;
  };
}
