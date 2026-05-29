/**
 * Shared Room Event domain types.
 * Extracted from libs/db/src/mongo/model/room-events.model so that
 * shared DTOs and edge apps can import EventRoomType without
 * pulling in Mongoose/MongodbModule.
 *
 * DO NOT import Mongoose in this file.
 */

export type EventRoomType =
  | 'member.joined'
  | 'member.pinded'
  | 'member.edit'
  | 'member.left'
  | 'member.change.role'
  | 'member.create'
  | 'member.added'
  | 'member.deleted'
  | 'member.unPinded'
  | 'member.change.name'
  | 'member.change.avatar'
  | 'member.change.nickName'
  // Group call lifecycle (only logged for sfu calls — private/p2p calls skip)
  | 'call.started'
  | 'call.joined'
  | 'call.left'
  | 'call.ended';
