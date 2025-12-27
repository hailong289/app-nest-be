// User models
export { User, UserSchema } from './user.model';
export { default as userModel } from './user.model';
export type { UserDocument } from './user.model';

// Room models
export { Room, RoomSchema, Member, MemberSchema } from './room.model';
export { default as roomModel } from './room.model';
export type {
  RoomDocument,
  roomType,
  roleMember,
  memberType,
} from './room.model';
export { RoomEvent, RoomEventSchema } from './room-events.model';
export { default as roomEventsModel } from './room-events.model';
export type { EventRoomType } from './room-events.model';
export { RoomsState, RoomsStateSchema } from './rooms-state.model';
export { default as roomsStateModel } from './rooms-state.model';
export type { RoomsStateDocument } from './rooms-state.model';
export {
  RoomsUsersState,
  RoomsUsersStateSchema,
} from './rooms-users-state.model';
export { default as roomsUsersStateModel } from './rooms-users-state.model';
export type { RoomsUsersStateDocument } from './rooms-users-state.model';

// Message models
export { Message, MessageSchema } from './messages.model';
export { default as messagesModel } from './messages.model';
export type { MessageDocument, MsgType } from './messages.model';
export { MessageRead, MessageReadSchema } from './message-reads.model';
export { default as messageReadsModel } from './message-reads.model';
export type { MessageReadDocument } from './message-reads.model';
export {
  MessageReaction,
  MessageReactionSchema,
} from './message-reactions.model';
export { default as messageReactionsModel } from './message-reactions.model';
export type { MessageReactionDocument } from './message-reactions.model';
export { MessageHide, MessageHideSchema } from './message-hides.model';
export { default as messageHidesModel } from './message-hides.model';
export type { MessageHideDocument } from './message-hides.model';

// Attachment model
export {
  Attachment,
  AttachmentSchema,
  AttachmentKindEnum,
  AttachmentContextEnumType,
} from './Attachment.model';
export { default as attachmentModel } from './Attachment.model';
export type { AttachmentKind, AttachmentStatus } from './Attachment.model';

// Authentication & Security models
export { Key, KeySchema } from './keys.model';
export { default as keysModel } from './keys.model';
export type { KeyDocument } from './keys.model';
export { Otp } from './otp.model';
export { default as otpModel } from './otp.model';
export type { OtpDocument } from './otp.model';

// Social models
export { Friendship } from './friendship.model';
export { default as friendshipModel } from './friendship.model';
export type { friendship } from './friendship.model';

// Notification models
export { Notification, NotificationSchema } from './notification.model';
export { default as notificationModel } from './notification.model';
export type {
  NotificationDocument,
  NotificationType,
} from './notification.model';

// Quiz models
export {
  Quiz,
  QuizSchema,
  Question,
  QuestionSchema,
  Answer,
  AnswerSchema,
  UserAnswer,
  UserAnswerSchema,
  QuizResult,
  QuizResultSchema,
} from './quiz.model';
export { default as quizModel } from './quiz.model';
export type {
  QuizDocument,
  QuizResultDocument,
  QuizStatus,
  QuestionType,
} from './quiz.model';

// Flashcard models
export {
  Flashcard,
  FlashcardSchema,
  FlashcardDeck,
  FlashcardDeckSchema,
  FlashcardProgress,
  FlashcardProgressSchema,
  flashcardDeckModel,
} from './flashcard.model';
export { default as flashcardModel } from './flashcard.model';
export type {
  FlashcardDocument,
  FlashcardDeckDocument,
  FlashcardProgressDocument,
} from './flashcard.model';

// Call History models
export { CallHistory, CallHistorySchema } from './call-history.model';
export { default as callHistoryModel } from './call-history.model';
export type {
  CallHistoryDocument,
  CallType,
  CallStatus,
} from './call-history.model';
//
export { default as aIEmbeddingModel } from './AIEmbedding.model';
export type { AIEmbeddingDocument } from './AIEmbedding.model';

export { default as aIUsageLogModel } from './AIUsageLogs.model';
export type { AIUsageLogsDocument } from './AIUsageLogs.model';

export {
  Document,
  DocumentSchema,
  DocVisibilityEnum,
  sharedWithRoleEnum,
} from './Document.model';
export { default as documentModel } from './Document.model';
export type {
  DocumentDocuments,
  DocVisibility,
  sharedWithRoleType,
} from './Document.model';
