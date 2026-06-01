// apps/common/schemas/ai-embedding.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  AiEmbeddingSourceService,
  AiEmbeddingSourceType,
  AiEmbeddingSnapshot,
} from '@app/dto/ai.dto';

export type AIEmbeddingDocument = HydratedDocument<AIEmbedding>;
export type AIEmbeddingContextType = 'room' | 'doc' | 'file';
@Schema({ timestamps: true })
export class AIEmbedding {
  @Prop({ required: true, index: true }) // Index để lọc nhanh theo service
  service: string; // 'moderation' | 'chat' | 'document'

  @Prop({ required: true, default: 'google' })
  provider: string;

  @Prop({ required: true })
  model: string; // Quan trọng: Không thể so sánh vector của 2 model khác nhau

  @Prop({ required: true })
  hash: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: [Number], required: true })
  vector: number[];

  @Prop({ index: true }) // Index để tìm nhanh lịch sử của user
  userId?: string;

  // Metadata để filter (Hybrid Search)
  @Prop({ index: true })
  contextType?: AIEmbeddingContextType; // 'room' | ...

  @Prop({ type: Types.ObjectId, default: null })
  contextId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  messageId?: Types.ObjectId; // message_id hoặc document_id

  @Prop({ type: String, index: true })
  sourceService?: AiEmbeddingSourceService;

  @Prop({ type: String, index: true })
  sourceType?: AiEmbeddingSourceType;

  @Prop({ type: String, index: true })
  sourceId?: string;

  @Prop({ type: String, index: true })
  roomId?: string;

  @Prop({ type: [String], default: [], index: true })
  roomIds?: string[];

  @Prop({ type: String })
  userBusinessId?: string;

  @Prop({ type: String })
  usrId?: string;

  @Prop({ type: Boolean, default: false, index: true })
  isSystemMessage?: boolean;

  @Prop({ type: String, index: true })
  visibility?: string;

  @Prop({ type: Object, default: {} })
  snapshot?: AiEmbeddingSnapshot;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AIEmbeddingSchema = SchemaFactory.createForClass(AIEmbedding);

AIEmbeddingSchema.index(
  { sourceService: 1, sourceType: 1, sourceId: 1 },
  { sparse: true },
);
AIEmbeddingSchema.index({ roomId: 1, sourceType: 1, createdAt: -1 });
AIEmbeddingSchema.index({ userId: 1, sourceType: 1, createdAt: -1 });
AIEmbeddingSchema.index({ roomIds: 1, sourceType: 1, createdAt: -1 });
AIEmbeddingSchema.index(
  { hash: 1, sourceType: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceType: { $exists: true },
      sourceId: { $exists: true },
    },
  },
);

export default {
  name: 'AIEmbedding',
  schema: AIEmbeddingSchema,
};
