/**
 * Redis Key Patterns - Best Practices 2025
 *
 * Naming Convention:
 * - Format: {namespace}:{entity}:{id}:{attribute}
 * - Use colons (:) as separators (standard Redis convention)
 * - Use lowercase with underscores for readability
 * - Include TTL information in comments where applicable
 *
 * Examples:
 * - chat:room:123:members
 * - chat:user:456:rooms
 * - chat:user:789:online
 */

export const REDISKEY = {
  // ==========================================
  // � AUTH KEYS
  // ==========================================
  REFRESH_TOKEN: (userId: string, jti: string) =>
    `auth:refresh_token:${userId}:${jti}`,

  // ==========================================
  // �💬 CHAT ROOM KEYS
  // ==========================================

  /**
   * Lưu danh sách members trong một room (Set)
   * Format: chat:room:{roomId}:members
   * Type: SET
   * Example: chat:room:rm_abc123:members
   */
  ROOM_MEMBERS: (roomId: string) => `chat:room:${roomId}:members`,

  /**
   * Lưu metadata của room (Hash)
   * Format: chat:room:{roomId}:info
   * Type: HASH
   * Fields: name, createdAt, updatedAt, lastMessageAt, etc.
   */
  ROOM_INFO: (roomId: string) => `chat:room:${roomId}:info`,

  /**
   * Lưu unread count của user trong room (String)
   * Format: chat:room:{roomId}:user:{userId}:unread
   * Type: STRING
   */
  ROOM_USER_UNREAD: (roomId: string, userId: string) =>
    `chat:room:${roomId}:user:${userId}:unread`,

  // ==========================================
  // 👤 USER KEYS
  // ==========================================
  ROOM_CLIENT: (userId: string) => `chat:user:${userId}:client`,
  /**
   * Lưu danh sách rooms của user (Set)
   * Format: chat:user:{userId}:rooms
   * Type: SET
   * Example: chat:user:68ff5ede5903ab252a84b117:rooms
   */
  USER_ROOMS: (userId: string) => `chat:user:${userId}:rooms`,

  /**
   * Cờ đánh dấu USER_ROOMS của user đã được nạp từ MongoDB ít nhất 1 lần kể từ
   * khi Redis còn sống. Dùng cho lazy-sync: connect lần đầu (cache lạnh) sẽ
   * rebuild từ DB rồi set cờ này; các lần sau chỉ đọc set, khỏi query Mongo.
   * Format: chat:user:{userId}:rooms:synced
   */
  USER_ROOMS_SYNCED: (userId: string) => `chat:user:${userId}:rooms:synced`,

  /**
   * Lưu danh sách friends của user (Set)
   * Format: chat:user:{userId}:friends
   * Type: SET
   */
  USER_FRIENDS: (userId: string) => `chat:user:${userId}:friends`,

  /**
   * Lưu friendship requests (pending) (Set)
   * Format: chat:user:{userId}:friend_requests
   * Type: SET
   */
  USER_FRIEND_REQUESTS: (userId: string) =>
    `chat:user:${userId}:friend_requests`,

  /**
   * Mapping userId -> socketId (String)
   * Format: chat:user:{userId}:socket_id
   * Type: STRING
   * TTL: Xóa khi disconnect
   */
  USER_SOCKET_ID: (userId: string) => `chat:user:${userId}:socket_id`,

  /**
   * Mapping socketId -> userId (String)
   * Format: chat:socket:{socketId}:user_id
   * Type: STRING
   * TTL: Xóa khi disconnect
   */
  SOCKET_USER_ID: (socketId: string) => `chat:socket:${socketId}:user_id`,

  // ==========================================
  // 🟢 ONLINE STATUS KEYS
  // ==========================================

  /**
   * Set chứa danh sách users đang online (Set) - DEPRECATED for performance
   * Format: chat:users:online
   * Type: SET
   * Members: userId1, userId2, ...
   */
  // USERS_ONLINE: 'chat:users:online:v2',

  /**
   * @deprecated Replaced by per-socket SOCKET_ALIVE TTL keys. Kept for
   * legacy reads during the rolling deploy; PresenceService no longer
   * writes to it.
   */
  USERS_HEARTBEAT: 'chat:users:heartbeat',

  /**
   * @deprecated User presence is now derived from `USER_ONLINE` set
   * cardinality. Kept here only so old code still compiles; new code reads
   * from `USER_ONLINE` via PresenceService.
   */
  USER_PRESENCE: (userId: string) => `chat:user:${userId}:presence`,

  /**
   * Set of currently-connected socket descriptors for this user.
   * Format: chat:user:{userId}:online
   * Type: SET
   * Members: `<ns>:<socketId>` (e.g. `chat:abc123`, `call:xyz789`).
   *
   * Online check: `sCard > 0` → user is online on at least one device.
   * Multi-device / multi-namespace safe: each tab+namespace contributes
   * exactly one entry, so a /chat tab disconnect doesn't mark the user
   * offline if their /call tab is still connected.
   */
  USER_ONLINE: (userId: string) => `chat:user:${userId}:online`,

  /**
   * Per-socket liveness key with TTL, refreshed by client heartbeat.
   * Format: chat:socket:{ns}:{socketId}:alive
   * Type: STRING
   * TTL: 45s (heartbeat every 15s + buffer)
   *
   * Used by the cleanup cron: a `<ns>:<sid>` member of `USER_ONLINE` set
   * whose corresponding alive key has expired is treated as a dead socket
   * and removed. When the set transitions to empty, broadcasts offline.
   */
  SOCKET_ALIVE: (ns: string, socketId: string) =>
    `chat:socket:${ns}:${socketId}:alive`,

  /**
   * Last seen timestamp của user (String)
   * Format: chat:user:{userId}:last_seen
   * Type: STRING
   * Value: ISO timestamp
   */
  USER_LAST_SEEN: (userId: string) => `chat:user:${userId}:last_seen`,

  // ==========================================
  // 📨 MESSAGE CACHE KEYS
  // ==========================================

  /**
   * Cache tin nhắn gần nhất của room (List)
   * Format: chat:room:{roomId}:messages:recent
   * Type: LIST (LPUSH, LTRIM to keep last 100)
   * TTL: 1 hour
   */
  ROOM_MESSAGES_RECENT: (roomId: string) =>
    `chat:room:${roomId}:messages:recent`,

  /**
   * Typing indicator trong room (Set với TTL)
   * Format: chat:room:{roomId}:typing
   * Type: SET
   * Members: userId1, userId2, ...
   * TTL: 5s (auto expire)
   */
  ROOM_TYPING: (roomId: string) => `chat:room:${roomId}:typing`,

  // ==========================================
  // 🔔 NOTIFICATION KEYS
  // ==========================================

  /**
   * FCM tokens của user (Set)
   * Format: chat:user:{userId}:fcm_tokens
   * Type: SET
   */
  USER_FCM_TOKENS: (userId: string) => `chat:user:${userId}:fcm_tokens`,

  /**
   * Unread notification count (String)
   * Format: chat:user:{userId}:unread_notifications
   * Type: STRING
   */
  USER_UNREAD_NOTIFICATIONS: (userId: string) =>
    `chat:user:${userId}:unread_notifications`,

  // ==========================================
  // 🔒 SESSION & AUTH KEYS
  // ==========================================

  /**
   * Rate limiting cho WebSocket connection
   * Format: chat:rate_limit:connect:{ip}
   * Type: STRING (counter)
   * TTL: 1 minute
   */
  RATE_LIMIT_CONNECT: (ip: string) => `chat:rate_limit:connect:${ip}`,

  /**
   * Rate limiting cho message sending
   * Format: chat:rate_limit:message:{userId}
   * Type: STRING (counter)
   * TTL: 10 seconds
   */
  RATE_LIMIT_MESSAGE: (userId: string) => `chat:rate_limit:message:${userId}`,

  // ==========================================
  // 📞 CALL KEYS
  // ==========================================

  /**
   * Tracks whether a user is currently in an active call (String)
   * Format: chat:user:{userId}:in_call
   * Type: STRING
   * Value: callId
   * TTL: 3600s (max call duration safety net)
   */
  USER_IN_CALL: (userId: string) => `chat:user:${userId}:in_call`,

  /**
   * Tracks WHICH socket of the user is the active call socket (String)
   * Format: chat:user:{userId}:call_socket
   * Type: STRING
   * Value: socketId currently holding the call (most recent device)
   * TTL: 3600s (matches USER_IN_CALL)
   *
   * Use case: multi-device handoff. When user accepts/joins from device B
   * while device A still has the call open → server emits `call:handoff` to
   * A's socketId, A closes its popup; this key flips to B's socketId.
   */
  USER_CALL_SOCKET: (userId: string) => `chat:user:${userId}:call_socket`,

  /**
   * Per-room runtime state for active group calls (Set).
   * Members = userIds currently SHARING SCREEN.
   * Format: chat:call:{roomId}:sharing
   * Type: SET<userId>
   * TTL: REDIS_TTL.CALL_ACTIVE — refreshed on every state change.
   * Auto-deletes when last member is sRem'd.
   */
  CALL_SHARING: (roomId: string) => `chat:call:${roomId}:sharing`,

  /**
   * Map of userId → screenProducerId for SFU mode (Hash).
   * Lets late-joiners pre-populate `screenProducerIds` so consume() routes
   * the screen track to remoteScreenStreams instead of remoteStreams.
   * Format: chat:call:{roomId}:share_pid
   * Type: HASH<userId, screenProducerId>
   * TTL: REDIS_TTL.CALL_ACTIVE.
   */
  CALL_SHARING_PRODUCER: (roomId: string) => `chat:call:${roomId}:share_pid`,

  /**
   * Per-room set of userIds whose CAMERA is OFF (Set).
   * Maintained by call:camera-state events. Late-joiners read this to
   * render avatar tiles immediately for users with camera off, instead of
   * showing a black box until the next event toggle.
   * Format: chat:call:{roomId}:camera_off
   * Type: SET<userId>
   * TTL: REDIS_TTL.CALL_ACTIVE.
   */
  CALL_CAMERA_OFF: (roomId: string) => `chat:call:${roomId}:camera_off`,

  /**
   * Per-room set of userIds whose MIC is MUTED (Set).
   * Same rationale as CALL_CAMERA_OFF — late-joiners need explicit state
   * because Chrome keeps RTP flowing on track.enabled=false (silent
   * audio), so receiver-side mute events can't be relied on.
   * Format: chat:call:{roomId}:mic_off
   * Type: SET<userId>
   * TTL: REDIS_TTL.CALL_ACTIVE.
   */
  CALL_MIC_OFF: (roomId: string) => `chat:call:${roomId}:mic_off`,

  /**
   * Pending incoming-call invites for a user (Hash). Stored when the
   * caller emits call:request — each invitee gets an entry so that if
   * they were socket-offline at emit time (logged out, tab not open, or
   * mid network blip) and reconnect during the ringing window, the
   * gateway can replay `call:request` to their new socket and surface
   * the IncomingCallModal.
   *
   * Format: chat:user:{userId}:pending_invites
   * Type: HASH<callId, JSON-serialized historyCall payload>
   * TTL: ~60s — ringing window (FE auto-declines at 30s, server buffer).
   *
   * Cleared on:
   *   - call:accepted by the recipient (they don't need the invite anymore)
   *   - call:end (any status — rejected/missed/cancelled/ended) for every
   *     invited member, since the call is over.
   */
  CALL_PENDING_INVITES: (userId: string) =>
    `chat:user:${userId}:pending_invites`,

  // ==========================================
  // 📢 PUBSUB CHANNELS
  // ==========================================
  PUBSUB_ROOM_UPDATE: 'events:room:update',
} as const;

/**
 * Redis Key TTL Constants (in seconds)
 */
export const REDIS_TTL = {
  ONLINE_STATUS: 30, // Heartbeat every 30s
  RECENT_MESSAGES: 3600, // 1 hour
  TYPING_INDICATOR: 5, // 5 seconds
  RATE_LIMIT_CONNECT: 60, // 1 minute
  RATE_LIMIT_MESSAGE: 10, // 10 seconds
  SESSION: 86400, // 24 hours
  // Safety net for call-related Redis keys. Long meetings (1h+) can
  // legitimately keep a call alive past the old 1h limit — we refresh
  // this TTL on every join/accept/signal event so the keys outlive
  // a continuously-active call. The 8h ceiling exists to clean up
  // truly forgotten zombies (browser frozen for a day, etc.) without
  // requiring an extra heartbeat ping from the FE.
  CALL_ACTIVE: 8 * 3600, // 8 hours — refreshed on every meaningful call event
  // Document cache (room/user) — read-heavy, ít thay đổi. L2 (Redis) giữ
  // bản full doc; L1 (RAM) có TTL ngắn riêng. Pub/sub invalidate khi đổi.
  CACHE_ENTITY: 1800, // 30 phút
} as const;

/**
 * Type helper for Redis keys
 */
export type RedisKeyType = typeof REDISKEY;
export type RedisTTLType = typeof REDIS_TTL;
