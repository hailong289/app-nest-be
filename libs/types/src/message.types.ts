/**
 * Shared chat/message domain types.
 *
 * Keep this file free of Mongoose/Nest decorators so DTOs and edge services can
 * use message/call contracts without importing Mongo models.
 */

export type MsgType =
  | 'text'
  | 'image'
  | 'file'
  | 'system'
  | 'video'
  | 'audio'
  | 'gif'
  | 'document'
  | 'quiz'
  | 'flashcard'
  | 'todo_project'
  | 'call';

export type CallType = 'video' | 'audio';

export type CallStatus = 'initiated' | 'started' | 'ended';

export type MemberStatus =
  | 'initiated'
  | 'pending'
  | 'started'
  | 'cancelled'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'joined'
  | 'accepted';
