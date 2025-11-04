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
  // 💬 CHAT ROOM KEYS
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
   * Set chứa danh sách users đang online (Set)
   * Format: chat:users:online
   * Type: SET
   * Members: userId1, userId2, ...
   */
  USERS_ONLINE: 'chat:users:online',

  /**
   * Online status của 1 user (String với TTL)
   * Format: chat:user:{userId}:online
   * Type: STRING
   * Value: timestamp của lần ping cuối
   * TTL: 30s (heartbeat)
   */
  USER_ONLINE: (userId: string) => `chat:user:${userId}:online`,

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
} as const;

/**
 * Type helper for Redis keys
 */
export type RedisKeyType = typeof REDISKEY;
export type RedisTTLType = typeof REDIS_TTL;
