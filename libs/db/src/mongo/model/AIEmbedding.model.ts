// apps/common/schemas/ai-embedding.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AIEmbeddingDocument = HydratedDocument<AIEmbedding>;

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

  // Metadata để filter (Hybrid Search)
  @Prop({ index: true })
  contextType?: string; // 'room' | ...

  @Prop({ index: true })
  contextId?: string;

  @Prop({ index: true })
  messageId?: string; // ID của tin nhắn chat (Nếu có)
}

export const AIEmbeddingSchema = SchemaFactory.createForClass(AIEmbedding);

export default {
  name: 'AIEmbedding',
  schema: AIEmbeddingSchema,
};
