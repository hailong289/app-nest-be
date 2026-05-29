import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';

export type TodoDocument = HydratedDocument<Todo>;

import type { TodoStatus, TodoPriority } from 'libs/types';

/**
 * TodoStatus, TodoPriority and DEFAULT_TODO_STATUSES are now defined in libs/types/src/todo.types.ts.
 * Re-exported here for backward compatibility.
 * @see libs/types/src/todo.types.ts
 */
export type { TodoStatus, TodoPriority } from 'libs/types';
export { DEFAULT_TODO_STATUSES } from 'libs/types';

@Schema({ timestamps: true, collection: 'Todos' })
export class Todo {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  todo_id: string;

  @Prop({ type: String, required: true })
  todo_title: string;

  @Prop({ type: String, default: '' })
  todo_description: string;

  @Prop({
    type: String,
    default: 'todo',
    index: true,
  })
  todo_status: TodoStatus;

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  })
  todo_priority: TodoPriority;

  @Prop({ type: Date, default: null })
  todo_dueDate: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Room', default: null, index: true })
  todo_roomId: Types.ObjectId | null; // null = todo cá nhân

  @Prop({ type: String, default: null, index: true })
  todo_projectId: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  todo_createdBy: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  todo_assignees: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export const TodoSchema = SchemaFactory.createForClass(Todo);

TodoSchema.index({ todo_createdBy: 1, createdAt: -1 });
TodoSchema.index({ todo_roomId: 1, createdAt: -1 });
TodoSchema.index({ todo_assignees: 1 });
TodoSchema.index({ todo_projectId: 1, createdAt: -1 });

export default {
  name: Todo.name,
  schema: TodoSchema,
};
