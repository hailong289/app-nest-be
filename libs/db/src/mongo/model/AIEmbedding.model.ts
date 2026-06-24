// apps/common/schemas/ai-embedding.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AIEmbeddingDocument = HydratedDocument<AIEmbedding>;
export type AIEmbeddingContextType = 'room' | 'doc';
@Schema({ timestamps: true })
export class AIEmbedding {
  @Prop({ required: true, index: true }) // Index để lọc nhanh theo service
  service: string; // 'moderation' | 'chat' | 'document'

  @Prop({ required: true, default: 'google' })
  provider: string;

  @Prop({ required: true })
  model: string; // Quan trọng: Không thể so sánh vector của 2 model khác nhau

  @Prop({ required: true, unique: true }) // Unique Index để đảm bảo không lưu trùng
  hash: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: [Number], required: true })
  vector: number[];

  @Prop({ index: true }) // Index để tìm nhanh lịch sử của user
  userId?: string;

  // Metadata để filter (Hybrid Search). Index đơn bỏ đi vì đã có compound
  // { contextType, contextId } bên dưới (prefix phủ luôn query chỉ theo contextType).
  @Prop()
  contextType?: AIEmbeddingContextType; // 'room' | ...

  @Prop({ type: Types.ObjectId, default: null })
  contextId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  messageId?: Types.ObjectId; // message_id hoặc document_id
}

export const AIEmbeddingSchema = SchemaFactory.createForClass(AIEmbedding);

// Search semantic lọc embedding theo contextType + contextId ($in) — đặc biệt
// ở fallback cosine/keyword (find({ $or: [{contextType, contextId}, ...] })).
// Compound index phục vụ cả query chỉ theo contextType (prefix).
AIEmbeddingSchema.index({ contextType: 1, contextId: 1 });

export default {
  name: 'AIEmbedding',
  schema: AIEmbeddingSchema,
};
