import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';
import { DEFAULT_TODO_STATUSES } from './todo.model';

export type TodoProjectDocument = HydratedDocument<TodoProject>;

export type ProjectStatus = {
  status_id: string;
  status_name: string;
  status_color: string;
  status_order: number;
};

export const DEFAULT_PROJECT_STATUS_COLORS: Record<string, string> = {
  todo: '#6B7280',
  in_progress: '#3B82F6',
  done: '#10B981',
  cancelled: '#EF4444',
};

const buildDefaultStatuses = (): ProjectStatus[] =>
  DEFAULT_TODO_STATUSES.map((status, index) => ({
    status_id: status,
    status_name: status,
    status_color: DEFAULT_PROJECT_STATUS_COLORS[status] ?? '#6B7280',
    status_order: index + 1,
  }));

@Schema({ _id: false, versionKey: false })
export class TodoProjectStatus {
  @Prop({ type: String, required: true })
  status_id: string;

  @Prop({ type: String, required: true })
  status_name: string;

  @Prop({ type: String, default: '#6B7280' })
  status_color: string;

  @Prop({ type: Number, required: true, min: 1 })
  status_order: number;
}

const TodoProjectStatusSchema = SchemaFactory.createForClass(TodoProjectStatus);

@Schema({ timestamps: true, collection: 'TodoProjects' })
export class TodoProject {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  project_id: string;

  @Prop({ type: String, required: true, trim: true })
  project_name: string;

  @Prop({ type: String, default: '' })
  project_description: string;

  @Prop({ type: String, default: '#3B82F6' })
  project_color: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  project_createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', default: null, index: true })
  project_roomId: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false, index: true })
  is_default: boolean;

  @Prop({ type: [TodoProjectStatusSchema], default: buildDefaultStatuses })
  project_statuses: ProjectStatus[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  project_members: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export const TodoProjectSchema = SchemaFactory.createForClass(TodoProject);

TodoProjectSchema.index(
  { project_createdBy: 1, project_roomId: 1, is_default: 1 },
  { unique: true, partialFilterExpression: { is_default: true } },
);

TodoProjectSchema.index({ project_createdBy: 1, project_roomId: 1, createdAt: -1 });
TodoProjectSchema.index({ project_members: 1 });

export default {
  name: TodoProject.name,
  schema: TodoProjectSchema,
};
