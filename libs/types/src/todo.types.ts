/**
 * Shared Todo domain types.
 * Extracted from libs/db/src/mongo/model/todo.model so that
 * edge apps (api-gateway, socket, sfu) and shared DTOs/types
 * can import these without pulling in Mongoose/MongodbModule.
 *
 * DO NOT import Mongoose in this file.
 */

export const DEFAULT_TODO_STATUSES = [
  'todo',
  'in_progress',
  'done',
  'cancelled',
] as const;

export type TodoStatus = (typeof DEFAULT_TODO_STATUSES)[number] | string;
export type TodoPriority = 'low' | 'medium' | 'high';
