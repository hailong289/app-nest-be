export enum socketEvent {
  MSGSEND = 'message:send',
  JOINROOM = 'join',
  ROOMUPSERT = 'room:upsert',
  MSGUPSERT = 'message:upsert',
  MSGREACT = 'message:emoji',
  MSGPINNED = 'message:pinned',
  MSGDELETE = 'message:delete',
  MSGRECALL = 'message:recall',
  USERSATUS = 'check:status_online',
  USERTYPING = 'user:typing',
  STATUSTYPING = 'on:typing',
  ERRORMSG = 'error:message',
  USERJOIN = 'user:join',
  EXCEPTION = 'exception',
  STATUS = 'status:online',
  ROOMDELETE = 'room:delete',
  MSGMARKREAD = 'mark:read',
  QUIZZANSWER = 'quizz:answer',
  UPDATE_QUIZ = 'update:quiz',
  UPDATE_TODO = 'update:todo',
  ROOM_REFRESH = 'room:refresh',
}

export enum notifyType {
  noify_new_message = 'notify:new:message',
}

/**
 * Loại event trong change-feed catch-up (outbox per-user). Client switch theo
 * `type` để apply vào IndexedDB. Xem plan/DONG_BO_EVENT_SYNC.md (bảng 2a).
 */
export enum ChangeEventType {
  /** thin {roomId,newestMsgId,newestMsgTs,count} — high-water-mark tin mới. */
  ROOM_NEWMSGS = 'room.newmsgs',
  /** fat: snapshot message — edit/soft-delete/pin/react. */
  MESSAGE_UPDATED = 'message.updated',
  /** thin {roomId,msgId} — delete-for-me (per-user). */
  MESSAGE_HIDDEN = 'message.hidden',
  /** fat {roomId,lastReadMsgId,lastReadAt,unreadCount} — read/unread đổi. */
  ROOM_READ = 'room.read',
  /** fat: room metadata — tạo/đổi tên/avatar/member/pin-list. */
  ROOM_UPSERTED = 'room.upserted',
  /** thin {roomId} — user bị kick/rời/phòng xoá. */
  ROOM_REMOVED = 'room.removed',
}

export enum KafkaEvent {
  ROOM_UPDATED = 'room.updated',
  // File System
  UPLOAD_SINGLE = 'upload_single_file',
  UPLOAD_SINGLE_REPLY = 'upload_single_file.reply',
  UPLOAD_MULTIPLE = 'upload_multiple_files',
  UPLOAD_MULTIPLE_REPLY = 'upload_multiple_files.reply',
  DELETE_FILE = 'delete_file',
  DELETE_FILE_REPLY = 'delete_file.reply',
  GET_PRESIGNED_URL = 'get_presigned_url',
  GET_PRESIGNED_URL_REPLY = 'get_presigned_url.reply',
  PROCESS_LINK = 'filesystem.processLink',

  // AI & Processing
  AI_CHAT_MSG_EMBEDDING = 'ai.createChatMessageEmbedding',
  AI_DOC_EMBEDDING = 'ai.createDocumentEmbedding',
  AI_PROCESS_FILE_EMBEDDING = 'ai.processFileEmbedding',
  AI_LOG_USAGE = 'ai.logUsage',

  // Room & Document
  CREATE_ROOMS = 'create_rooms',
  SHARE_DOC_FOR_ROOM = 'document.shareforRoom',

  // Chat — tail bất đồng bộ sau khi đã tạo message (chat tự consume)
  MESSAGE_PERSISTED = 'chat.messagePersisted',
  // Chat — ghi outbox change-feed (catch-up sync). Chat tự consume rồi bulkWrite
  // per-recipient vào UserChangeEvents. Xem plan/DONG_BO_EVENT_SYNC.md.
  OUTBOX_APPEND = 'chat.outboxAppend',

  // Notification & Auth
  SEND_OTP = 'send_otp',
  FORGOT_PASSWORD = 'forgot_password',
  PUSH_NOTIFICATION = 'push_notification',
  PUSH_NOTIFICATION_USERS = 'push_notification_users',

  // Document Events
  DOC_CREATED = 'DOC_CREATED',
  DOC_UPDATED = 'DOC_UPDATED',
  DOC_NEW_VERSION = 'DOC_NEW_VERSION',
  DOC_MOVED = 'DOC_MOVED',
  DOC_DELETED = 'DOC_DELETED',
  DOC_RESTORED = 'DOC_RESTORED',
  DOC_SHARED = 'DOC_SHARED',

  // Workflow Events
  FLOW_SUBMITTED = 'FLOW_SUBMITTED',
  FLOW_APPROVED = 'FLOW_APPROVED',
  FLOW_REJECTED = 'FLOW_REJECTED',
  FLOW_REQ_CHANGE = 'FLOW_REQ_CHANGE',
  FLOW_OVERDUE = 'FLOW_OVERDUE',

  // Comment & Task Events
  CMT_ADDED = 'CMT_ADDED',
  USER_MENTIONED = 'USER_MENTIONED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',

  // System & Security Events
  SYS_QUOTA_WARN = 'SYS_QUOTA_WARN',
  SYS_CONVERT_FAIL = 'SYS_CONVERT_FAIL',
  SEC_LOGIN_ALERT = 'SEC_LOGIN_ALERT',
  SEC_ACCESS_DENIED = 'SEC_ACCESS_DENIED',
}
