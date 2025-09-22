// Service names and configurations
export const SERVICES = {
  AUTH: 'AUTH_SERVICE',
  CHAT: 'CHAT_SERVICE',
  NOTIFICATION: 'NOTIFICATION_SERVICE',
  FILESYSTEM: 'FILESYSTEM_SERVICE',
} as const;

// Service ports
export const SERVICE_PORTS = {
  API_GATEWAY: 3000,
  AUTH: 3001,
  CHAT: 3002,
  NOTIFICATION: 3003,
  FILESYSTEM: 3004,
} as const;

// Message patterns
export const MESSAGE_PATTERNS = {
  // Auth patterns
  AUTH_LOGIN: 'login',
  AUTH_REGISTER: 'register',
  AUTH_VALIDATE_TOKEN: 'validate_token',
  AUTH_GET_USER: 'get_user',

  // Chat patterns
  CHAT_GET_MESSAGES: 'get_messages',
  CHAT_SEND_MESSAGE: 'send_message',
  CHAT_GET_ROOMS: 'get_rooms',
  CHAT_CREATE_ROOM: 'create_room',
  CHAT_JOIN_ROOM: 'join_room',

  // Notification patterns
  NOTIFICATION_SEND_WELCOME_EMAIL: 'send_welcome_email',
  NOTIFICATION_SEND_PUSH: 'send_push_notification',

  // Filesystem patterns
  FILESYSTEM_UPLOAD_SINGLE: 'upload_single_file',
  FILESYSTEM_UPLOAD_MULTIPLE: 'upload_multiple_files',
  FILESYSTEM_DELETE_FILE: 'delete_file',
  FILESYSTEM_GET_PRESIGNED_URL: 'get_presigned_url',
} as const;

// Transport configurations
export const TRANSPORT_CONFIG = {
  TCP: {
    AUTH: {
      host: 'localhost',
      port: SERVICE_PORTS.AUTH,
    },
    CHAT: {
      host: 'localhost',
      port: SERVICE_PORTS.CHAT,
    },
    NOTIFICATION: {
      host: 'localhost',
      port: SERVICE_PORTS.NOTIFICATION,
    },
    FILESYSTEM: {
      host: 'localhost',
      port: SERVICE_PORTS.FILESYSTEM,
    },
  },
} as const;
